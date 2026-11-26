import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const packageDir = path.resolve(import.meta.dirname, '..')
const root = path.resolve(packageDir, '..')
const dsh = process.env.DSH_BIN ?? 'dsh'
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-fixture-home-'))
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-fixture-ws-'))
let server
let test
let cleaned = false

function cleanup() {
  if (cleaned) return
  cleaned = true
  test?.kill('SIGTERM')
  server?.kill('SIGTERM')
  fs.rmSync(tempHome, { recursive: true, force: true })
  fs.rmSync(workspace, { recursive: true, force: true })
}
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(130) })
process.on('SIGTERM', () => { cleanup(); process.exit(143) })

const env = { ...process.env, DSH_HOME: tempHome }

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`)))
  })
}

try {
  await run(dsh, ['--profile', 'fixture', '--from-default-profile', 'web', '--dump-config'])
  await run(dsh, ['plugin', '--profile', 'fixture', 'add', `link:${path.join(root, 'dsh-collab-api', 'packages', 'dsh-collab-auth-api')}`])
  await run(dsh, ['plugin', '--profile', 'fixture', 'add', `link:${packageDir}`])

  server = spawn(dsh, ['--profile', 'fixture', '--port', '0', '--no-open'], {
    cwd: workspace,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`fixture web did not start\n${output}`)), 60_000)
    const read = (chunk) => {
      output += chunk
      const match = /dsh web: (http:\/\/[^\s]+)/u.exec(output)
      if (match !== null) {
        clearTimeout(timer)
        resolve(match[1])
      }
    }
    server.stdout.on('data', read)
    server.stderr.on('data', read)
    server.once('exit', code => {
      clearTimeout(timer)
      reject(new Error(`fixture web exited ${code}\n${output}`))
    })
  })

  test = spawn(process.execPath, ['--test', 'test/browser.smoke.mjs'], {
    cwd: packageDir,
    env: {
      ...env,
      DSH_BROWSER_TEST: '1',
      DSH_BROWSER_CREATE_SUPERVISOR: '1',
      DSH_BROWSER_ISOLATED: '1',
      DSH_WEB_URL: url,
    },
    stdio: 'inherit',
  })
  const code = await new Promise((resolve, reject) => {
    test.once('error', reject)
    test.once('exit', resolve)
  })
  process.exitCode = code ?? 1
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  cleanup()
}
