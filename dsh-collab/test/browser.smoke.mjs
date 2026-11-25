/**
 * Opt-in real-browser smoke test for the collab client.
 *
 * It launches headless Chrome, authenticates with the local DSH browser-session
 * credential, and exercises the sidebar entry, the new-session menu, and the
 * generated authorization Remote.
 *
 * Run it with:
 *   DSH_BROWSER_TEST=1 npm run test:browser
 *
 * CI without Chrome or without a local DSH profile skips the test. The test is
 * deliberately separate from the unit suite because it needs a running DSH Web
 * server and a local browser.
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const WEB_URL = process.env.DSH_WEB_URL
const ENABLED = process.env.DSH_BROWSER_TEST === '1'
const CHROME = process.env.DSH_CHROME_PATH ?? findChrome()

function findChrome() {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  return candidates.find(candidate => fs.existsSync(candidate))
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

function browserSecret() {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const file = path.join(home, '.credentials.yaml')
  if (!fs.existsSync(file)) return undefined
  const text = fs.readFileSync(file, 'utf8')
  const match = /client-connection\/browser-session:[\s\S]{0,400}?\n\s+secret:\s*([A-Za-z0-9_-]+)/u.exec(text)
  if (match === null) return undefined
  try {
    const secret = Buffer.from(match[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
    return secret.byteLength === 32 ? secret : undefined
  } catch {
    return undefined
  }
}

function browserCookie(web, secret) {
  const authority = new URL(web).host
  const now = Date.now()
  const body = Buffer.from(JSON.stringify({
    version: 1,
    authority,
    issuedAt: now,
    expiresAt: now + 24 * 60 * 60 * 1000,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return {
    name: `dsh-auth-${crypto.createHash('sha256').update(authority).digest('base64url')}`,
    value: `v1.${body}.${signature}`,
  }
}

async function waitForHttp(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/json/version`, response => {
          let body = ''
          response.on('data', chunk => { body += chunk })
          response.on('end', () => resolve(body))
        }).on('error', reject)
      })
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  throw new Error('Chrome DevTools endpoint did not become ready')
}

async function pageTarget(port) {
  const targets = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json`, response => {
      let body = ''
      response.on('data', chunk => { body += chunk })
      response.on('end', () => resolve(JSON.parse(body)))
    }).on('error', reject)
  })
  const page = targets.find(target => target.type === 'page')
  if (page === undefined) throw new Error('Chrome did not expose a page target')
  return page
}

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  let nextId = 0
  const pending = new Map()
  const events = []
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined && pending.has(message.id)) {
      const resolve = pending.get(message.id)
      pending.delete(message.id)
      resolve(message)
    } else if (message.method !== undefined) {
      events.push(message)
    }
  }
  const send = (method, params = {}) => new Promise(resolve => {
    const id = ++nextId
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const message = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    })
    if (message.result?.exceptionDetails !== undefined) {
      throw new Error(message.result.exceptionDetails.text ?? 'browser evaluation failed')
    }
    return message.result?.result?.value
  }
  return { socket, send, evaluate, events }
}

async function waitFor(evaluate, expression, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await evaluate(`Boolean(${expression})`)) return
    } catch {
      // The document is briefly unavailable while Chrome commits the navigation.
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for ${expression}`)
}

test('real browser: collab entry, menu, and authorization page', async t => {
  if (!ENABLED) {
    t.skip('set DSH_BROWSER_TEST=1 to run the browser smoke test')
    return
  }
  if (WEB_URL === undefined) {
    t.skip('DSH_WEB_URL is not set')
    return
  }
  if (CHROME === undefined) {
    t.skip('Chrome/Chromium was not found')
    return
  }
  const secret = browserSecret()
  if (secret === undefined) {
    t.skip('the local DSH browser-session credential is not readable')
    return
  }

  const port = await freePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-browser-'))
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ], { stdio: 'ignore' })
  t.after(() => {
    try { chrome.kill('SIGKILL') } catch { /* already gone */ }
    fs.rmSync(profile, { recursive: true, force: true })
  })

  await waitForHttp(port)
  const target = await pageTarget(port)
  const browser = await connect(target.webSocketDebuggerUrl)
  t.after(() => browser.socket.close())

  await browser.send('Network.enable')
  await browser.send('Page.enable')
  await browser.send('Runtime.enable')
  await browser.send('Log.enable')
  const cookie = browserCookie(WEB_URL, secret)
  const cookieResult = await browser.send('Network.setCookie', {
    ...cookie,
    url: WEB_URL,
    path: '/',
    httpOnly: true,
    sameSite: 'Strict',
  })
  assert.equal(cookieResult.result?.success, true)

  await browser.send('Page.navigate', { url: WEB_URL })
  await new Promise(resolve => setTimeout(resolve, 3000))
  await browser.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find(element => element.getAttribute('aria-label') === '打开侧边栏')
    if (button !== undefined) button.click()
  })()`)
  await waitFor(browser.evaluate, "document.body.innerText.includes('新建协同会话')", 15_000)
  assert.equal(await browser.evaluate('document.title'), 'DeepSeek Harness')

  // The sidebar entry must exist before the dropdown can be opened.
  assert.equal(
    await browser.evaluate("Boolean(document.querySelector('.dsh-collab-new-button'))"),
    true,
  )
  await browser.evaluate("document.querySelector('.dsh-collab-new-button').click()")
  await waitFor(browser.evaluate, "document.querySelector('[role=\"menuitem\"]') !== null")
  const menuItems = await browser.evaluate(`Array.from(
    document.querySelectorAll('[role="menuitem"]'),
  ).map(element => element.textContent.trim()).filter(Boolean)`)
  assert.ok(menuItems.includes('协同会话'), `menu items: ${menuItems.join(', ')}`)
  assert.ok(menuItems.includes('超级会话'), `menu items: ${menuItems.join(', ')}`)

  // Escape closes the menu without creating a session.
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })

  // Open the authorization Remote page.
  await browser.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find(element => element.textContent.trim() === '协同授权')
    if (button === undefined) throw new Error('authorization entry not found')
    button.click()
  })()`)
  await waitFor(browser.evaluate, "document.body.innerText.includes('已授权会话对')")
  const authText = await browser.evaluate('document.body.innerText')
  assert.match(authText, /已授权会话对/u)
  assert.match(authText, /协同会话/u)
  assert.match(authText, /刷新/u)

  const authButtons = await browser.evaluate(`Array.from(document.querySelectorAll('button'))
    .map(element => element.textContent.trim())
    .filter(Boolean)`)
  assert.ok(authButtons.some(text => text.startsWith('已授权会话对')))
  assert.ok(authButtons.some(text => text.startsWith('协同会话')))
  assert.ok(authButtons.includes('刷新'))
  const authPresets = await browser.evaluate(`Array.from(document.querySelectorAll('[data-collab-preset]'))
    .map(element => element.getAttribute('data-collab-preset'))`)
  assert.equal(authPresets.every(preset => preset === 'collab' || preset === 'supervisor'), true)

  const clickedTab = await browser.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find(element => element.textContent.trim().startsWith('协同会话 ('))
    if (button === undefined) return false
    button.click()
    return true
  })()`)
  assert.equal(clickedTab, true)
  await waitFor(browser.evaluate, "document.body.innerText.includes('勾选两个会话')")

  if (process.env.DSH_BROWSER_CREATE_SUPERVISOR === '1') {
    await browser.evaluate("document.querySelector('.dsh-collab-new-button').click()")
    await waitFor(browser.evaluate, "document.querySelector('[role=\"menuitem\"]') !== null")
    await browser.evaluate(`(() => {
      const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
        .find(element => element.textContent.includes('超级会话'))
      if (item !== undefined) item.click()
    })()`)
    await new Promise(resolve => setTimeout(resolve, 3000))
    await browser.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('button'))
        .find(element => element.getAttribute('aria-label') === '打开右侧边栏')
      if (button !== undefined) button.click()
    })()`)
    await waitFor(browser.evaluate, `document.querySelector('[role="tab"]') !== null`, 10_000)
    const autoTabs = await browser.evaluate(`Array.from(document.querySelectorAll('[role="tab"], .dsh-collab-board-tab-title')).map(element => element.textContent.trim()).filter(Boolean)`)
    assert.ok(autoTabs.some(text => text.includes('任务')), `tabs: ${autoTabs.join(', ')}`)

  }

  const exceptions = browser.events
    .filter(event => event.method === 'Runtime.exceptionThrown')
    .map(event => JSON.stringify(event.params?.exceptionDetails ?? {}))
  assert.deepEqual(exceptions, [])
})

test('real browser: supervisor tabs seed when the right sidebar opens', async t => {
  if (!ENABLED) {
    t.skip('set DSH_BROWSER_TEST=1 to run the browser smoke test')
    return
  }
  if (process.env.DSH_BROWSER_SUPERVISOR_TITLE === undefined) {
    t.skip('set DSH_BROWSER_SUPERVISOR_TITLE to an existing supervisor session title')
    return
  }
  if (WEB_URL === undefined || CHROME === undefined) {
    t.skip('DSH_WEB_URL or Chrome is missing')
    return
  }
  const secret = browserSecret()
  if (secret === undefined) {
    t.skip('the local DSH browser-session credential is not readable')
    return
  }
  const port = await freePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-browser-'))
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ], { stdio: 'ignore' })
  t.after(() => {
    try { chrome.kill('SIGKILL') } catch { /* already gone */ }
    fs.rmSync(profile, { recursive: true, force: true })
  })
  await waitForHttp(port)
  const target = await pageTarget(port)
  const browser = await connect(target.webSocketDebuggerUrl)
  t.after(() => browser.socket.close())
  await browser.send('Network.enable')
  await browser.send('Page.enable')
  await browser.send('Runtime.enable')
  await browser.send('Log.enable')
  const cookie = browserCookie(WEB_URL, secret)
  assert.equal((await browser.send('Network.setCookie', {
    ...cookie,
    url: WEB_URL,
    path: '/',
    httpOnly: true,
    sameSite: 'Strict',
  })).result?.success, true)
  await browser.send('Page.navigate', { url: WEB_URL })
  await waitFor(browser.evaluate, "document.querySelector('.dsh-collab-new-button') !== null", 15_000)
  await browser.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find(element => element.getAttribute('aria-label') === '打开侧边栏')
    if (button !== undefined) button.click()
  })()`)
  await waitFor(browser.evaluate, "document.body.innerText.includes('新建协同会话')", 15_000)

  await browser.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find(element => element.textContent.trim().startsWith('展开其余'))
    if (button !== undefined) button.click()
  })()`)
  await new Promise(resolve => setTimeout(resolve, 400))
  const title = process.env.DSH_BROWSER_SUPERVISOR_TITLE
  const clicked = await browser.evaluate(`(() => {
    const title = ${JSON.stringify(title)}
    const node = Array.from(document.querySelectorAll('span, div'))
      .find(element => element.children.length === 0 && element.textContent.trim() === title)
    if (node === undefined) return false
    const target = node.closest('button, [role="button"], [data-session-id]') ?? node
    target.click()
    return true
  })()`)
  if (!clicked) {
    t.skip(`supervisor row not visible in this profile: ${title}`)
    return
  }
  await waitFor(browser.evaluate, "document.body.innerText.includes('打开右侧边栏')", 10_000)
  await browser.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find(element => element.getAttribute('aria-label') === '打开右侧边栏')
    if (button !== undefined) button.click()
  })()`)
  await waitFor(browser.evaluate, `document.querySelector('[role="tab"]') !== null`, 10_000)
  const tabs = await browser.evaluate(`Array.from(document.querySelectorAll('[role="tab"], .dsh-collab-board-tab-title'))
    .map(element => element.textContent.trim())
    .filter(Boolean)`)
  assert.ok(tabs.some(text => text.includes('任务')), `tabs: ${tabs.join(', ')}`)
  assert.ok(tabs.some(text => text.includes('注册')), `tabs: ${tabs.join(', ')}`)
  const exceptions = browser.events
    .filter(event => event.method === 'Runtime.exceptionThrown')
    .map(event => event.params?.exceptionDetails?.text ?? 'unknown exception')
  assert.deepEqual(exceptions, [])
})
