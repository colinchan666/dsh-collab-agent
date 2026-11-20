import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../index.js'

const PRESET = 'collab'
const A = 'session-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'session-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PLAIN = 'session-cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const D = 'session-dddddddd-dddd-4ddd-8ddd-dddddddddddd'

/** Minimal Cordis-shaped surface used by index.js. */
function fakeHarness(workspace) {
  const handlers = new Map()
  const live = new Map()
  const services = new Map()
  const tools = []
  const guards = []
  const effects = []
  const prompts = new Map()
  const workspaces = { created: [], attached: [] }
  const commands = []
  const workspaceRegistry = {
    list: () => [],
    async create(path, title) {
      workspaces.created.push({ path, title })
      return {
        workspaceId: 'ws-collab',
        path,
        title,
        attachSession: async sessionId => { workspaces.attached.push(sessionId) },
      }
    },
  }
  const ctx = {
    logger: { warn: () => {} },
    commands: {
      register(definition) { commands.push(definition); return () => {} },
    },
    get(name) {
      if (services.has(name)) return services.get(name)
      return name === 'workspaceRegistry' ? workspaceRegistry : undefined
    },
    provide(name, value) {
      services.set(name, value)
      return () => { services.delete(name) }
    },
    on(event, listener) {
      handlers.set(event, [...(handlers.get(event) ?? []), listener])
    },
    effect(factory) {
      const disposer = factory()
      effects.push(disposer)
    },
    workingDirectory: {
      defaultDirectory: workspace,
      get: session => session.currentCwd,
      async set(agent, directory) {
        agent.session.currentCwd = directory
        return directory
      },
    },
    agents: {
      list: () => [...live.values()],
      get: id => live.get(id),
    },
    tools: {
      register(definition, options = {}) {
        tools.push({ definition, options })
        return () => {}
      },
      guard(guard) {
        guards.push(guard)
        return () => {}
      },
    },
  }
  const emit = async (event, ...args) => {
    for (const listener of handlers.get(event) ?? []) await listener(...args)
  }
  const makeAgent = (id, preset, cwd = workspace) => {
    const session = {
      id,
      header: { id, cwd, agentPreset: preset, isSeeded: false },
      currentCwd: cwd,
    }
    const sessions = []
    const agent = {
      id,
      session,
      ctx: {
        inject(_services, callback) {
          callback({
            systemPrompt: {
              section(section) {
                sessions.push(section)
                return () => {}
              },
              getSectionOrder: () => 2800,
            },
          })
          return { dispose: async () => {} }
        },
      },
    }
    prompts.set(id, sessions)
    live.set(id, agent)
    return agent
  }
  return { ctx, emit, makeAgent, tools, guards, effects, prompts, live, workspaces, commands }
}

test('agent/created prepares the layout, moves the cwd, and registers gated tools', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-host-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const a = harness.makeAgent(A, PRESET)
    const b = harness.makeAgent(B, PRESET)
    const plain = harness.makeAgent(PLAIN, 'standard')
    await harness.emit('agent/created', { agent: a, source: 'startup' })
    await harness.emit('agent/created', { agent: b, source: 'startup' })
    await harness.emit('agent/created', { agent: plain, source: 'startup' })

    const workdirA = path.join(workspace, '.dsh-collab', 'sessions', A)
    const workdirB = path.join(workspace, '.dsh-collab', 'sessions', B)
    for (const workdir of [workdirA, workdirB]) {
      assert.deepEqual(fs.readdirSync(workdir).sort(), ['comm', 'private', 'session.json'])
    }
    assert.equal(a.session.currentCwd, workdirA)
    assert.equal(b.session.currentCwd, workdirB)
    assert.equal(plain.session.currentCwd, workspace)

    assert.equal(harness.tools.length, 23)
    for (const name of ['collab_info', 'collab_peers', 'collab_send', 'collab_inbox']) {
      const entry = harness.tools.find(tool => tool.definition.name === name)
      assert.equal(entry.options.when({ agent: a }), true, name)
      assert.equal(entry.options.when({ agent: plain }), false, name)
    }
    const prompt = harness.prompts.get(A)[0]
    assert.ok(prompt.text().includes(workdirA))
    assert.ok(prompt.text().includes('collab_send'))
    const registry = JSON.parse(fs.readFileSync(path.join(root, 'registry.json'), 'utf8'))
    assert.deepEqual(Object.keys(registry.sessions).sort(), [A, B])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('collab-base persists a per-session base prompt and injects it into the prompt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-base-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const a = harness.makeAgent(A, PRESET)
    await harness.emit('agent/created', { agent: a, source: 'startup' })
    const command = harness.commands.find(entry => entry.name === 'collab-base')
    assert.ok(command)
    const basePrompt = '你是代码审查员。只审查，不修改文件；回答使用中文。'
    const encoded = Buffer.from(basePrompt, 'utf8').toString('base64')
    const set = await command.handler({ agent: a, rawInput: ` set ${encoded}`, attachments: [], signal: new AbortController().signal })
    assert.equal(JSON.parse(set.text).basePrompt, basePrompt)
    const get = await command.handler({ agent: a, rawInput: ' get', attachments: [], signal: new AbortController().signal })
    assert.equal(JSON.parse(get.text).basePrompt, basePrompt)
    const prompt = harness.prompts.get(A)[0]
    assert.match(prompt.text(), /你是代码审查员/)
    const meta = JSON.parse(fs.readFileSync(path.join(workspace, '.dsh-collab', 'sessions', A, 'session.json'), 'utf8'))
    assert.equal(meta.basePrompt, basePrompt)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a supervisor links a worker, assigns a task, and the worker completes it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-supervisor-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const supervisor = harness.makeAgent(A, 'supervisor')
    const worker = harness.makeAgent(B, 'collab')
    await harness.emit('agent/created', { agent: supervisor, source: 'startup' })
    await harness.emit('agent/created', { agent: worker, source: 'startup' })
    assert.match(harness.prompts.get(A)[0].text(), /SUPERVISOR/)
    const link = harness.commands.find(entry => entry.name === 'collab-link')
    assert.ok(link)
    const payload = Buffer.from(JSON.stringify({
      capability: { name: 'test-worker', description: 'runs a test task' },
      offer: true,
    }), 'utf8').toString('base64')
    const linked = await link.handler({
      agent: supervisor,
      rawInput: `link ${B} ${payload}`,
      attachments: [],
      signal: new AbortController().signal,
    })
    assert.equal(linked.kind, 'success')
    const capabilities = harness.tools.find(entry => entry.definition.name === 'collab_capabilities')
    const sessionFile = path.join(worker.session.currentCwd, 'session.json')
    fs.writeFileSync(sessionFile, JSON.stringify({ basePrompt: 'live capability v1' }))
    const liveOne = capabilities.definition.execute({}, { agent: supervisor })
    assert.match(liveOne, /live capability v1/u)
    assert.match(liveOne, /source=live/u)
    const pin = await link.handler({
      agent: supervisor,
      rawInput: `pin ${B}`,
      attachments: [],
      signal: new AbortController().signal,
    })
    assert.equal(pin.kind, 'success')
    fs.writeFileSync(sessionFile, JSON.stringify({ basePrompt: 'live capability v2' }))
    const pinned = capabilities.definition.execute({}, { agent: supervisor })
    assert.match(pinned, /live capability v1/u)
    assert.match(pinned, /source=override/u)
    assert.match(pinned, /changed=yes/u)
    const useLive = await link.handler({
      agent: supervisor,
      rawInput: `live ${B}`,
      attachments: [],
      signal: new AbortController().signal,
    })
    assert.equal(useLive.kind, 'success')
    const liveTwo = capabilities.definition.execute({}, { agent: supervisor })
    assert.match(liveTwo, /live capability v2/u)
    assert.match(liveTwo, /source=live/u)
    const create = harness.tools.find(entry => entry.definition.name === 'collab_task_create')
    const assign = harness.tools.find(entry => entry.definition.name === 'collab_task_assign')
    const accept = harness.tools.find(entry => entry.definition.name === 'collab_task_accept')
    const complete = harness.tools.find(entry => entry.definition.name === 'collab_task_complete')
    const result = harness.tools.find(entry => entry.definition.name === 'collab_task_result')
    assert.ok(create && assign && accept && complete && result)
    assert.equal(create.options.when({ agent: supervisor }), true)
    assert.equal(create.options.when({ agent: worker }), false)
    assert.equal(accept.options.when({ agent: worker }), true)
    assert.equal(accept.options.when({ agent: supervisor }), false)
    assert.equal(harness.tools.find(entry => entry.definition.name === 'collab_send').options.when({ agent: worker }), false)
    await harness.emit('session/event', supervisor.session, {
      type: 'tool/call',
      data: { callId: 'call-create', turn: 4 },
    })
    const created = JSON.parse(create.definition.execute(
      { title: 'Test task', instruction: 'Do the test', acceptance: 'Done' },
      { agent: supervisor, callId: 'call-create' },
    ))
    const taskId = created.task.id
    assert.equal(created.task.createdTurn, 4)
    await harness.emit('session/event', supervisor.session, {
      type: 'tool/call',
      data: { callId: 'call-assign', turn: 5 },
    })
    const assigned = await assign.definition.execute(
      { taskId, worker: B },
      { agent: supervisor, callId: 'call-assign' },
    )
    assert.match(assigned, /assigned:/)
    const accepted = JSON.parse(accept.definition.execute({ taskId }, { agent: worker }))
    assert.equal(accepted.status, 'accepted')
    const completed = await complete.definition.execute(
      { taskId, summary: 'done' },
      { agent: worker },
    )
    assert.match(completed, /completed:/)
    const detail = JSON.parse(result.definition.execute({ taskId }, { agent: supervisor }))
    assert.equal(detail.status, 'done')
    assert.equal(detail.createdTurn, 4)
    assert.equal(detail.assignedTurn, 5)
    assert.equal(detail.result.summary, 'done')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a request-enabled worker asks a supervisor and gets decomposed work', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-request-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const supervisor = harness.makeAgent(A, 'supervisor')
    const worker = harness.makeAgent(B, 'collab')
    await harness.emit('agent/created', { agent: supervisor, source: 'startup' })
    await harness.emit('agent/created', { agent: worker, source: 'startup' })
    const link = harness.commands.find(entry => entry.name === 'collab-link')
    const payload = Buffer.from(JSON.stringify({
      capability: { name: 'test-worker', description: 'runs a test task' },
      offer: true,
      request: true,
    }), 'utf8').toString('base64')
    const linked = await link.handler({
      agent: supervisor,
      rawInput: `link ${B} ${payload}`,
      attachments: [],
      signal: new AbortController().signal,
    })
    assert.equal(linked.kind, 'success')
    const requestOff = await link.handler({
      agent: supervisor,
      rawInput: `request ${B} off`,
      attachments: [],
      signal: new AbortController().signal,
    })
    assert.equal(requestOff.kind, 'success')
    const requestOn = await link.handler({
      agent: supervisor,
      rawInput: `request ${B} on`,
      attachments: [],
      signal: new AbortController().signal,
    })
    assert.equal(requestOn.kind, 'success')
    const submit = harness.tools.find(entry => entry.definition.name === 'collab_request_submit')
    const requests = harness.tools.find(entry => entry.definition.name === 'collab_requests')
    const create = harness.tools.find(entry => entry.definition.name === 'collab_task_create')
    const assign = harness.tools.find(entry => entry.definition.name === 'collab_task_assign')
    const accept = harness.tools.find(entry => entry.definition.name === 'collab_request_accept')
    const reject = harness.tools.find(entry => entry.definition.name === 'collab_request_reject')
    assert.ok(submit && requests && create && assign && accept && reject)
    assert.equal(submit.options.when({ agent: worker }), true)
    assert.equal(submit.options.when({ agent: supervisor }), false)
    assert.equal(accept.options.when({ agent: supervisor }), true)
    assert.equal(accept.options.when({ agent: worker }), false)
    const submitted = JSON.parse(await submit.definition.execute(
      { title: 'Need a report', requirement: 'Produce a short report' },
      { agent: worker },
    ))
    const requestId = submitted.request.id
    assert.equal(submitted.request.status, 'pending')
    const pending = JSON.parse(requests.definition.execute({ status: 'pending' }, { agent: supervisor }))
    assert.equal(pending.length, 1)
    assert.equal(pending[0].id, requestId)
    const created = JSON.parse(create.definition.execute(
      { title: 'Report', instruction: 'Produce the report' },
      { agent: supervisor },
    ))
    await assign.definition.execute(
      { projectId: created.projectId, taskId: created.task.id, worker: B },
      { agent: supervisor },
    )
    const accepted = JSON.parse(await accept.definition.execute(
      { requestId, projectId: created.projectId, response: 'Accepted' },
      { agent: supervisor },
    ))
    assert.equal(accepted.request.status, 'accepted')
    assert.equal(accepted.request.projectId, created.projectId)
    assert.equal(accepted.tasks.length, 1)
    const own = JSON.parse(requests.definition.execute({}, { agent: worker }))
    assert.equal(own[0].status, 'accepted')
    const second = JSON.parse(await submit.definition.execute(
      { title: 'Need another report', requirement: 'A second report' },
      { agent: worker },
    ))
    const rejected = JSON.parse(await reject.definition.execute(
      { requestId: second.request.id, reason: 'missing report-writing capability' },
      { agent: supervisor },
    ))
    assert.equal(rejected.request.status, 'rejected')
    assert.equal(rejected.request.reason, 'missing report-writing capability')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a worker can write only its delivery subdirectory, and only while the project is open', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-delivery-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const supervisor = harness.makeAgent(A, 'supervisor')
    const worker = harness.makeAgent(B, 'collab')
    await harness.emit('agent/created', { agent: supervisor, source: 'startup' })
    await harness.emit('agent/created', { agent: worker, source: 'startup' })
    const link = harness.commands.find(entry => entry.name === 'collab-link')
    const payload = Buffer.from(JSON.stringify({
      capability: { name: 'delivery-test' },
      offer: true,
    }), 'utf8').toString('base64')
    await link.handler({ agent: supervisor, rawInput: `link ${B} ${payload}`, attachments: [], signal: new AbortController().signal })
    const create = harness.tools.find(entry => entry.definition.name === 'collab_task_create')
    const assign = harness.tools.find(entry => entry.definition.name === 'collab_task_assign')
    const close = harness.tools.find(entry => entry.definition.name === 'collab_project_close')
    const created = JSON.parse(create.definition.execute(
      { title: 'Delivery task', instruction: 'write a file', acceptance: 'file exists' },
      { agent: supervisor },
    ))
    const taskId = created.task.id
    const assigned = await assign.definition.execute({ taskId, worker: B }, { agent: supervisor })
    const deliveryDir = /deliveryDir: (.+)/.exec(assigned)?.[1]
    assert.ok(deliveryDir)
    const guard = harness.guards[0]
    assert.equal(guard({ agent: worker, name: 'write', arguments: { path: path.join(deliveryDir, 'result.md') } }), undefined)
    assert.ok(guard({ agent: worker, name: 'write', arguments: { path: path.join(workspace, '.dsh-collab', 'sessions', A, 'private', 'x.md') } }))
    const complete = harness.tools.find(entry => entry.definition.name === 'collab_task_complete')
    await complete.definition.execute({ taskId, summary: 'written' }, { agent: worker })
    await close.definition.execute({ projectId: created.projectId }, { agent: supervisor })
    assert.ok(guard({ agent: worker, name: 'write', arguments: { path: path.join(deliveryDir, 'result.md') } }))
    assert.equal(guard({ agent: worker, name: 'read', arguments: { path: path.join(deliveryDir, 'result.md') } }), undefined)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a preset selected on an existing blank session installs and then removes collaboration setup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-preset-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const blank = harness.makeAgent(PLAIN, 'standard')
    await harness.emit('agent/created', { agent: blank, source: 'startup' })
    const workdir = path.join(workspace, '.dsh-collab', 'sessions', PLAIN)
    assert.equal(fs.existsSync(workdir), false)
    await harness.emit('agent-preset/selected', PLAIN, 'collab')
    assert.deepEqual(fs.readdirSync(workdir).sort(), ['comm', 'private', 'session.json'])
    assert.equal(harness.tools[0].options.when({ agent: blank }), true)
    assert.ok(harness.prompts.get(PLAIN).length === 1)
    await harness.emit('agent-preset/selected', PLAIN, 'standard')
    assert.equal(harness.tools[0].options.when({ agent: blank }), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('collab_send resumes a cold target and delivers a wake notification', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-send-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const a = harness.makeAgent(A, PRESET)
    const b = harness.makeAgent(B, PRESET)
    await harness.emit('agent/created', { agent: a, source: 'startup' })
    await harness.emit('agent/created', { agent: b, source: 'startup' })
    harness.live.delete(B)
    const delivered = []
    harness.ctx.agents.resume = async ({ resumeSessionId }) => {
      const resumed = { id: resumeSessionId, followup: message => delivered.push(message) }
      harness.live.set(resumeSessionId, resumed)
      return { agent: resumed, dispose: async () => {} }
    }
    await harness.commands[0].handler({
      agent: a,
      rawInput: `authorize ${A} ${B}`,
      attachments: [],
      signal: new AbortController().signal,
    })
    const tool = harness.tools.find(entry => entry.definition.name === 'collab_send').definition
    const result = await tool.execute(
      { target: B, message: 'hello from A' },
      { agent: a, name: 'collab_send', arguments: { target: B, message: 'hello from A' } },
    )
    assert.match(result, /resumed/)
    assert.equal(delivered.length, 1)
    assert.match(delivered[0].content[0].text, /collab_inbox/)
    const inbox = path.join(workspace, '.dsh-collab', 'sessions', A, 'comm', B, 'outbox')
    assert.equal(fs.readdirSync(inbox).filter(name => name.endsWith('.json')).length, 1)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a running target is steered into its next step instead of waiting for its next turn', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-steer-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const a = harness.makeAgent(A, PRESET)
    const b = harness.makeAgent(B, PRESET)
    await harness.emit('agent/created', { agent: a, source: 'startup' })
    await harness.emit('agent/created', { agent: b, source: 'startup' })
    const steered = []
    let followedUp = false
    b.status = 'running'
    b.steer = message => steered.push(message)
    b.followup = () => { followedUp = true }
    await harness.commands[0].handler({
      agent: a,
      rawInput: `authorize ${A} ${B}`,
      attachments: [],
      signal: new AbortController().signal,
    })
    const tool = harness.tools.find(entry => entry.definition.name === 'collab_send').definition
    const result = await tool.execute(
      { target: B, message: 'quick reply' },
      { agent: a, name: 'collab_send', arguments: { target: B, message: 'quick reply' } },
    )
    assert.match(result, /steered/)
    assert.equal(steered.length, 1)
    assert.equal(followedUp, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('collab_send refuses a pair that is not explicitly authorized', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-unauthorized-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const a = harness.makeAgent(A, PRESET)
    const b = harness.makeAgent(B, PRESET)
    await harness.emit('agent/created', { agent: a, source: 'startup' })
    await harness.emit('agent/created', { agent: b, source: 'startup' })
    const tool = harness.tools.find(entry => entry.definition.name === 'collab_send').definition
    await assert.rejects(
      tool.execute(
        { target: B, message: 'should be blocked' },
        { agent: a, name: 'collab_send', arguments: { target: B, message: 'should be blocked' } },
      ),
      /未授权|协作授权/,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('collab_inbox hides a queued message after the pair is revoked', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-revoke-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const a = harness.makeAgent(A, PRESET)
    const b = harness.makeAgent(B, PRESET)
    await harness.emit('agent/created', { agent: a, source: 'startup' })
    await harness.emit('agent/created', { agent: b, source: 'startup' })
    const command = harness.commands[0].handler
    const invocation = { agent: a, attachments: [], signal: new AbortController().signal }
    await command({ ...invocation, rawInput: `authorize ${A} ${B}` })
    const send = harness.tools.find(entry => entry.definition.name === 'collab_send').definition
    await send.execute(
      { target: B, message: 'should be hidden after revoke' },
      { agent: a, name: 'collab_send', arguments: { target: B, message: 'should be hidden after revoke' } },
    )
    await command({ ...invocation, rawInput: `revoke ${A} ${B}` })
    const inbox = harness.tools.find(entry => entry.definition.name === 'collab_inbox').definition
    const text = inbox.execute({}, { agent: b, name: 'collab_inbox', arguments: {} })
    assert.match(text, /blocked by authorization/)
    assert.doesNotMatch(text, /should be hidden after revoke/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a one-sided grant does not authorize communication until the other side grants too', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-bilateral-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const a = harness.makeAgent(A, PRESET)
    const b = harness.makeAgent(B, PRESET)
    await harness.emit('agent/created', { agent: a, source: 'startup' })
    await harness.emit('agent/created', { agent: b, source: 'startup' })
    const command = harness.commands[0].handler
    const invocation = { agent: a, attachments: [], signal: new AbortController().signal }
    const oneSide = await command({ ...invocation, rawInput: `grant ${A} ${B}` })
    const oneSideState = JSON.parse(oneSide.text)
    assert.equal(oneSideState.pairs.length, 0)
    assert.equal(oneSideState.pending.length, 1)
    const tool = harness.tools.find(entry => entry.definition.name === 'collab_send').definition
    await assert.rejects(
      tool.execute(
        { target: B, message: 'blocked one-sided' },
        { agent: a, name: 'collab_send', arguments: { target: B, message: 'blocked one-sided' } },
      ),
      /未授权|协作授权/,
    )
    await command({ ...invocation, rawInput: `grant ${B} ${A}` })
    const result = await tool.execute(
      { target: B, message: 'allowed bilateral' },
      { agent: a, name: 'collab_send', arguments: { target: B, message: 'allowed bilateral' } },
    )
    assert.match(result, /delivered|queued/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the guard denies foreign workdir access through every supported tool shape', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-guard-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const a = harness.makeAgent(A, PRESET)
    const b = harness.makeAgent(B, PRESET)
    const plain = harness.makeAgent(PLAIN, 'standard')
    await harness.emit('agent/created', { agent: a, source: 'startup' })
    await harness.emit('agent/created', { agent: b, source: 'startup' })
    await harness.emit('agent/created', { agent: plain, source: 'startup' })
    const guard = harness.guards[0]
    const workdirB = path.join(workspace, '.dsh-collab', 'sessions', B)
    const workdirA = path.join(workspace, '.dsh-collab', 'sessions', A)
    const denied = call => guard({ agent: a, name: call.name, arguments: call.arguments })
    const allowed = call => guard({ agent: a, name: call.name, arguments: call.arguments })

    assert.equal(denied({ name: 'read', arguments: { file_path: path.join(workdirB, 'private', 'x') } }).info.code, 'COLLAB_WORKDIR_SCOPE')
    assert.equal(denied({ name: 'read', arguments: { file_path: path.join(workdirB, 'comm', A, 'credential.json') } }).info.code, 'COLLAB_WORKDIR_SCOPE')
    assert.equal(denied({ name: 'bash', arguments: { command: `cat ${workdirB}/private/x` } }).info.code, 'COLLAB_WORKDIR_SCOPE')
    assert.equal(denied({ name: 'bash', arguments: { command: 'cat private/x', workdir: path.join(workdirB) } }).info.code, 'COLLAB_WORKDIR_SCOPE')
    assert.equal(denied({ name: 'bash', arguments: { command: 'cat ../*/private/*' } }).info.code, 'COLLAB_WORKDIR_SCOPE')
    assert.equal(denied({ name: 'working_directory', arguments: { cd: path.join(workdirB, 'private') } }).info.code, 'COLLAB_WORKDIR_SCOPE')
    assert.equal(denied({ name: 'glob', arguments: { pattern: `${workdirB}/private/**` } }).info.code, 'COLLAB_WORKDIR_SCOPE')
    assert.equal(allowed({ name: 'read', arguments: { file_path: path.join(workdirA, 'private', 'x') } }), undefined)
    assert.equal(allowed({ name: 'read', arguments: { file_path: path.join(workdirA, 'comm', B, 'credential.json') } }), undefined)
    a.session.currentCwd = workspace
    assert.equal(denied({ name: 'grep', arguments: { pattern: 'secret' } }).info.code, 'COLLAB_WORKDIR_SCOPE')
    assert.equal(denied({ name: 'bash', arguments: { command: 'ls' } }).info.code, 'COLLAB_WORKDIR_SCOPE')
    a.session.currentCwd = workdirA
    assert.equal(denied({ name: 'grep', arguments: { pattern: 'secret', path: workspace } }).info.code, 'COLLAB_WORKDIR_SCOPE')
    assert.equal(allowed({ name: 'grep', arguments: { pattern: 'secret', path: workdirA } }), undefined)
    assert.equal(denied({ name: 'apply_patch', arguments: { input: `*** Begin Patch\n*** Update File: ${path.join(workdirB, 'private', 'x')}\n` } }).info.code, 'COLLAB_WORKDIR_SCOPE')
    assert.equal(denied({ name: 'office_render', arguments: { input: path.join(workdirB, 'private', 'x.docx') } }).info.code, 'COLLAB_WORKDIR_SCOPE')
    // A normal project session keeps its shell/search behavior but still cannot
    // read a collaboration work directory by path.
    assert.equal(guard({ agent: plain, name: 'bash', arguments: { command: 'ls' } }), undefined)
    assert.equal(guard({ agent: plain, name: 'grep', arguments: { pattern: 'x' } }), undefined)
    assert.equal(guard({ agent: plain, name: 'read', arguments: { file_path: path.join(workdirB, 'private', 'x') } }).info.code, 'COLLAB_WORKDIR_SCOPE')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
