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
const E = 'session-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

function openParentTask(harness, supervisor, title = 'Parent task') {
  const open = harness.tools.find(entry => entry.definition.name === 'collab_task_open')
  return JSON.parse(open.definition.execute({ title }, { agent: supervisor })).task.taskId
}

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
    const sandboxPolicy = {
      resolve: () => ({ mode: 'workspace-write', workspaceRoot: workspace }),
      registerWritableRoot: () => () => {},
    }
    harness.ctx.provide('sandboxPolicy', sandboxPolicy)
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
    assert.equal(sandboxPolicy.resolve({ session: a.session }).workspaceRoot, workdirA)
    assert.equal(sandboxPolicy.resolve({ session: plain.session }).workspaceRoot, workspace)

    assert.equal(harness.tools.length, 40)
    const doctor = harness.tools.find(entry => entry.definition.name === 'collab_doctor')
    assert.ok(doctor)
    const doctorOutput = JSON.parse(doctor.definition.execute({}, { agent: a }))
    assert.equal(typeof doctorOutput.registry, 'number')
    assert.equal(typeof doctorOutput.invalidGrants, 'number')
    for (const name of ['collab_info', 'collab_peers', 'collab_send', 'collab_inbox']) {
      const entry = harness.tools.find(tool => tool.definition.name === name)
      assert.equal(entry.options.when({ agent: a }), true, name)
      assert.equal(entry.options.when({ agent: plain }), false, name)
    }
    const prompt = harness.prompts.get(A)[0]
    assert.ok(prompt.text().includes(workdirA))
    assert.ok(prompt.text().includes('collab_send'))
    assert.ok(harness.guards[0]({
      agent: plain,
      name: 'write',
      arguments: { path: path.join(root, 'shared', 'project-test', 'artifacts', 'x.txt') },
    }))
    const admin = harness.ctx.get('collabAdmin')
    assert.throws(() => admin.authorize('session-unknown', A), /known collaboration sessions/u)
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
    assert.equal(harness.tools.find(entry => entry.definition.name === 'collab_send').options.when({ agent: worker }), true)
    await harness.emit('session/event', supervisor.session, {
      type: 'tool/call',
      data: { callId: 'call-create', turn: 4 },
    })
    const parentTaskId = openParentTask(harness, supervisor)
    const created = JSON.parse(create.definition.execute(
      { taskId: parentTaskId, title: 'Test task', instruction: 'Do the test', acceptance: 'Done' },
      { agent: supervisor, callId: 'call-create' },
    ))
    const taskId = created.subtask.id
    assert.equal(created.subtask.createdTurn, 4)
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

test('a requester asks a supervisor and gets decomposed work', async () => {
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
    const inbox = harness.tools.find(entry => entry.definition.name === 'collab_inbox')
    assert.match(inbox.definition.execute({}, { agent: supervisor }), /kind: request/u)
    const pending = JSON.parse(requests.definition.execute({ status: 'pending' }, { agent: supervisor }))
    assert.equal(pending.length, 1)
    assert.equal(pending[0].id, requestId)
    const parentTaskId = openParentTask(harness, supervisor, 'Report')
    const created = JSON.parse(create.definition.execute(
      { taskId: parentTaskId, title: 'Report', instruction: 'Produce the report' },
      { agent: supervisor },
    ))
    await assign.definition.execute(
      { taskId: created.taskId, subtaskId: created.subtask.id, worker: B },
      { agent: supervisor },
    )
    const accepted = JSON.parse(await accept.definition.execute(
      { requestId, taskId: created.taskId, response: 'Accepted' },
      { agent: supervisor },
    ))
    assert.equal(accepted.request.status, 'accepted')
    assert.equal(accepted.request.taskId, created.taskId)
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

test('an ordinary authorized peer can submit a request without an offer', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-ordinary-request-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json'), executionTimeoutMs: 200 })
    const supervisor = harness.makeAgent(A, 'supervisor')
    const worker = harness.makeAgent(B, 'collab')
    const requester = harness.makeAgent(E, 'collab')
    await harness.emit('agent/created', { agent: supervisor, source: 'startup' })
    await harness.emit('agent/created', { agent: worker, source: 'startup' })
    await harness.emit('agent/created', { agent: requester, source: 'startup' })
    const link = harness.commands.find(entry => entry.name === 'collab-link')
    const payload = Buffer.from(JSON.stringify({
      capability: { name: 'worker', description: 'does tasks' },
      offer: true,
    }), 'utf8').toString('base64')
    await link.handler({
      agent: supervisor,
      rawInput: `link ${B} ${payload}`,
      attachments: [],
      signal: new AbortController().signal,
    })
    const auth = harness.commands.find(entry => entry.name === 'collab-auth')
    await auth.handler({
      agent: requester,
      rawInput: `authorize ${A} ${E}`,
      attachments: [],
      signal: new AbortController().signal,
    })
    const submit = harness.tools.find(entry => entry.definition.name === 'collab_request_submit')
    const requests = harness.tools.find(entry => entry.definition.name === 'collab_requests')
    assert.equal(submit.options.when({ agent: requester }), true)
    const submitted = JSON.parse(await submit.definition.execute(
      { title: 'Ordinary request', requirement: 'Do the work' },
      { agent: requester },
    ))
    assert.equal(submitted.request.requester, E)
    const create = harness.tools.find(entry => entry.definition.name === 'collab_task_create')
    const assign = harness.tools.find(entry => entry.definition.name === 'collab_task_assign')
    const accept = harness.tools.find(entry => entry.definition.name === 'collab_request_accept')
    const parentTaskId = openParentTask(harness, supervisor, 'Ordinary request')
    const created = JSON.parse(create.definition.execute(
      { taskId: parentTaskId, title: 'Task from ordinary request', instruction: 'Do it' },
      { agent: supervisor },
    ))
    await assign.definition.execute({ taskId: created.subtask.id, worker: B }, { agent: supervisor })
    const accepted = JSON.parse(await accept.definition.execute(
      { requestId: submitted.request.id, taskId: created.taskId },
      { agent: supervisor },
    ))
    assert.equal(accepted.request.status, 'accepted')
    assert.equal(accepted.request.requester, E)
    const requesterView = JSON.parse(requests.definition.execute({}, { agent: requester }))
    assert.equal(requesterView[0].status, 'accepted')
    assert.equal(requesterView[0].projectId, undefined)
    assert.equal(requesterView[0].taskIds, undefined)
    const requesterInbox = harness.tools.find(entry => entry.definition.name === 'collab_inbox').definition.execute({}, { agent: requester })
    assert.match(requesterInbox, /kind: request/u)
    assert.doesNotMatch(requesterInbox, /projectId|taskId/u)
    await new Promise(resolve => setTimeout(resolve, 300))
    const overdueView = JSON.parse(requests.definition.execute({}, { agent: requester }))
    assert.equal(overdueView[0].status, 'accepted')
    assert.equal(overdueView[0].overdue, true)
    const overdueInbox = harness.tools.find(entry => entry.definition.name === 'collab_inbox')
      .definition.execute({}, { agent: requester })
    assert.match(overdueInbox, /request-overdue/u)
    const heartbeat = harness.tools.find(entry => entry.definition.name === 'collab_request_heartbeat')
    const progressed = JSON.parse(await heartbeat.definition.execute(
      { requestId: submitted.request.id, note: 'still working', extendByMs: 5000 },
      { agent: supervisor },
    ))
    assert.notEqual(progressed.request.overdue, true)
    assert.ok(progressed.request.executionDeadlineAt > Date.now())
    const progressInbox = harness.tools.find(entry => entry.definition.name === 'collab_inbox')
      .definition.execute({}, { agent: requester })
    assert.match(progressInbox, /request-progress/u)
    const completeTask = harness.tools.find(entry => entry.definition.name === 'collab_task_complete')
    await completeTask.definition.execute({ taskId: created.subtask.id, summary: 'done' }, { agent: worker })
    const closeTask = harness.tools.find(entry => entry.definition.name === 'collab_task_close')
    closeTask.definition.execute({ taskId: created.taskId }, { agent: supervisor })
    const deliver = harness.tools.find(entry => entry.definition.name === 'collab_request_deliver')
    await assert.rejects(
      deliver.definition.execute({ requestId: submitted.request.id }, { agent: supervisor }),
      /no artifacts/u,
    )
    const deliveryDir = path.join(root, 'shared', created.taskId, 'artifacts')
    fs.mkdirSync(deliveryDir, { recursive: true })
    fs.writeFileSync(path.join(deliveryDir, 'artifact.md'), 'artifact')
    const guard = harness.guards[0]
    assert.ok(guard({ agent: requester, name: 'read', arguments: { path: path.join(deliveryDir, 'artifact.md') } }))
    assert.ok(guard({ agent: requester, name: 'write', arguments: { path: path.join(deliveryDir, 'x.md') } }))
    const firstDelivery = JSON.parse(await deliver.definition.execute({ requestId: submitted.request.id }, { agent: supervisor }))
    assert.equal(firstDelivery.alreadyDelivered, undefined)
    assert.equal(guard({ agent: requester, name: 'read', arguments: { path: path.join(deliveryDir, 'artifact.md') } }), undefined)
    const aliasArtifact = path.join(root, 'shared', '.deliveries', firstDelivery.deliveryId, 'artifacts', 'artifact.md')
    assert.equal(guard({ agent: requester, name: 'read', arguments: { path: aliasArtifact } }), undefined)
    const deliveredInbox = harness.tools.find(entry => entry.definition.name === 'collab_inbox')
      .definition.execute({}, { agent: requester })
    assert.match(deliveredInbox, /request-delivered/u)
    assert.doesNotMatch(deliveredInbox, /project-[0-9a-f]/u)
    const afterDelivery = JSON.parse(requests.definition.execute({}, { agent: requester }))
    assert.equal(afterDelivery[0].status, 'delivered')
    assert.ok(afterDelivery[0].delivery?.deliveryId)
    const secondDelivery = JSON.parse(await deliver.definition.execute({ requestId: submitted.request.id }, { agent: supervisor }))
    assert.equal(secondDelivery.alreadyDelivered, true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a pending request expires and notifies the requester', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-request-timeout-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json'), requestTimeoutMs: 150 })
    const supervisor = harness.makeAgent(A, 'supervisor')
    const requester = harness.makeAgent(E, 'collab')
    await harness.emit('agent/created', { agent: supervisor, source: 'startup' })
    await harness.emit('agent/created', { agent: requester, source: 'startup' })
    const auth = harness.commands.find(entry => entry.name === 'collab-auth')
    await auth.handler({
      agent: requester,
      rawInput: `authorize ${A} ${E}`,
      attachments: [],
      signal: new AbortController().signal,
    })
    const submit = harness.tools.find(entry => entry.definition.name === 'collab_request_submit')
    const submitted = JSON.parse(await submit.definition.execute(
      { title: 'Timeout request', requirement: 'Do it later' },
      { agent: requester },
    ))
    assert.ok(submitted.request.expiresAt > Date.now() - 1000)
    await new Promise(resolve => setTimeout(resolve, 300))
    const requests = harness.tools.find(entry => entry.definition.name === 'collab_requests')
    const view = JSON.parse(requests.definition.execute({}, { agent: requester }))
    assert.equal(view[0].status, 'expired')
    assert.match(view[0].reason, /did not respond/u)
    const inbox = harness.tools.find(entry => entry.definition.name === 'collab_inbox')
      .definition.execute({}, { agent: requester })
    assert.match(inbox, /request-expired/u)
    const accept = harness.tools.find(entry => entry.definition.name === 'collab_request_accept')
    await assert.rejects(
      accept.definition.execute({ requestId: submitted.request.id, taskId: 'task-timeout' }, { agent: supervisor }),
      /expired/u,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('communication is role-agnostic after bilateral authorization', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-communication-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const supervisor = harness.makeAgent(A, 'supervisor')
    const worker = harness.makeAgent(B, 'collab')
    const ordinary = harness.makeAgent(E, 'collab')
    await harness.emit('agent/created', { agent: supervisor, source: 'startup' })
    await harness.emit('agent/created', { agent: worker, source: 'startup' })
    await harness.emit('agent/created', { agent: ordinary, source: 'startup' })
    supervisor.status = 'running'
    supervisor.steer = () => {}
    worker.status = 'running'
    worker.steer = () => {}
    ordinary.status = 'running'
    ordinary.steer = () => {}
    const link = harness.commands.find(entry => entry.name === 'collab-link')
    const payload = Buffer.from(JSON.stringify({
      capability: { name: 'test-worker', description: 'runs a test task' },
      offer: true,
    }), 'utf8').toString('base64')
    await link.handler({
      agent: supervisor,
      rawInput: `link ${B} ${payload}`,
      attachments: [],
      signal: new AbortController().signal,
    })
    const auth = harness.commands.find(entry => entry.name === 'collab-auth')
    for (const pair of [[A, E], [B, E]]) {
      const result = await auth.handler({
        agent: ordinary,
        rawInput: `authorize ${pair[0]} ${pair[1]}`,
        attachments: [],
        signal: new AbortController().signal,
      })
      assert.equal(result.kind, 'success')
    }
    const send = harness.tools.find(entry => entry.definition.name === 'collab_send')
    assert.equal(send.options.when({ agent: supervisor }), true)
    assert.equal(send.options.when({ agent: worker }), true)
    assert.equal(send.options.when({ agent: ordinary }), true)
    const call = (agent, target, message) => send.definition.execute(
      { target, message },
      { agent, name: 'collab_send', arguments: { target, message } },
    )
    assert.match(await call(ordinary, A, 'requirement from ordinary'), /sent:/)
    assert.match(await call(supervisor, E, 'request received'), /sent:/)
    assert.match(await call(worker, E, 'chat from worker'), /sent:/)
    const outbox = path.join(ordinary.session.currentCwd, 'comm', A, 'outbox')
    const file = fs.readdirSync(outbox).find(name => name.endsWith('.json'))
    assert.ok(file)
    const message = JSON.parse(fs.readFileSync(path.join(outbox, file), 'utf8'))
    assert.equal(message.kind, 'chat')
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
    const close = harness.tools.find(entry => entry.definition.name === 'collab_task_close')
    const parentTaskId = openParentTask(harness, supervisor, 'Delivery task')
    const created = JSON.parse(create.definition.execute(
      { taskId: parentTaskId, title: 'Delivery task', instruction: 'write a file', acceptance: 'file exists' },
      { agent: supervisor },
    ))
    const taskId = created.subtask.id
    const assigned = await assign.definition.execute({ taskId, worker: B }, { agent: supervisor })
    const deliveryDir = /deliveryDir: (.+)/.exec(assigned)?.[1]
    assert.ok(deliveryDir)
    const listTasks = harness.tools.find(entry => entry.definition.name === 'collab_tasks')
    assert.match(listTasks.definition.execute({}, { agent: worker }), new RegExp(taskId, 'u'))
    assert.match(listTasks.definition.execute({ status: 'assigned' }, { agent: supervisor }), new RegExp(taskId, 'u'))
    const guard = harness.guards[0]
    assert.equal(guard({ agent: worker, name: 'write', arguments: { path: path.join(deliveryDir, 'result.md') } }), undefined)
    fs.mkdirSync(deliveryDir, { recursive: true })
    fs.writeFileSync(path.join(deliveryDir, 'result.md'), 'delivered')
    assert.ok(guard({ agent: worker, name: 'write', arguments: { path: path.join(path.dirname(deliveryDir), 'adhoc.md') } }))
    const sessions = path.join(workspace, '.dsh-collab', 'sessions')
    assert.ok(guard({ agent: worker, name: 'bash', arguments: { workdir: deliveryDir, command: `cd ${sessions} && cat ${A}/private/secret.txt` } }))
    assert.ok(guard({ agent: worker, name: 'bash', arguments: { workdir: deliveryDir, command: `cat ${sessions}/*/private/*` } }))
    assert.ok(guard({ agent: worker, name: 'bash', arguments: { workdir: deliveryDir, command: `echo pwn > ${path.join(workspace, 'pwn.txt')}` } }))
    assert.ok(guard({ agent: worker, name: 'bash', arguments: { workdir: deliveryDir, command: 'cp result.md /tmp/exfil.txt' } }))
    assert.ok(guard({ agent: worker, name: 'bash', arguments: { workdir: deliveryDir, command: 'cd /tmp && echo pwn > escaped.txt' } }))
    assert.equal(guard({ agent: worker, name: 'bash', arguments: { workdir: deliveryDir, command: 'echo ok > result2.md' } }), undefined)
    assert.equal(guard({ agent: worker, name: 'bash', arguments: { workdir: deliveryDir, command: `shasum -a 256 ${deliveryDir}/result.md` } }), undefined)
    assert.equal(guard({ agent: worker, name: 'pwsh', arguments: { workdir: deliveryDir, command: 'Set-Content -Path result3.md -Value ok' } }), undefined)
    assert.ok(guard({ agent: worker, name: 'pwsh', arguments: { workdir: deliveryDir, command: 'Set-Content -Path ../../pwn.txt -Value ok' } }))
    assert.ok(guard({ agent: worker, name: 'pwsh', arguments: { workdir: deliveryDir, command: `Get-Content ${path.join(sessions, A, 'private', 'secret.txt')}` } }))
    assert.equal(guard({ agent: worker, name: 'pwsh', arguments: { workdir: deliveryDir, command: `Get-FileHash ${deliveryDir}/result.md` } }), undefined)
    assert.ok(guard({ agent: worker, name: 'apply_patch', arguments: { input: `*** Begin Patch\n*** Add File: ${path.join(workspace, 'pwn.js')}\n+alert(1)\n*** End Patch` } }))
    assert.equal(guard({ agent: worker, name: 'apply_patch', arguments: { input: `*** Begin Patch\n*** Add File: ${path.join(deliveryDir, 'new.md')}\n+ok\n*** End Patch` } }), undefined)
    worker.session.currentCwd = deliveryDir
    assert.equal(guard({ agent: worker, name: 'write', arguments: { path: path.join(sessions, B, 'private', 'own.txt') } }), undefined)
    const supervisorPrivate = path.join(sessions, A, 'private')
    fs.mkdirSync(supervisorPrivate, { recursive: true })
    const secret = path.join(supervisorPrivate, 'secret.txt')
    fs.writeFileSync(secret, 'secret')
    const symlinkPath = path.join(deliveryDir, 'link-to-private.txt')
    try {
      fs.symlinkSync(secret, symlinkPath, 'file')
      assert.ok(guard({ agent: worker, name: 'read', arguments: { path: symlinkPath } }))
    } catch { /* platforms without symlinks */ }
    const manifestTool = harness.tools.find(entry => entry.definition.name === 'collab_delivery_manifest')
    const createTool = harness.tools.find(entry => entry.definition.name === 'collab_task_create')
    assert.throws(() => createTool.definition.execute(
      { title: 'Copy out', instruction: `复制到 ${path.join(root, 'shared', 'adhoc')}` },
      { agent: supervisor },
    ), /copy-out/u)
    const manifest = JSON.parse(manifestTool.definition.execute({ taskId: created.taskId }, { agent: supervisor }))
    assert.equal(manifest.files.length, 1)
    assert.equal(manifest.files[0].bytes, 9)
    assert.match(manifest.files[0].sha256, /^[0-9a-f]{64}$/)
    assert.match(manifest.files[0].mode, /^0[0-7]{3}$/)
    assert.ok(guard({ agent: worker, name: 'write', arguments: { path: path.join(workspace, '.dsh-collab', 'sessions', A, 'private', 'x.md') } }))
    const complete = harness.tools.find(entry => entry.definition.name === 'collab_task_complete')
    await complete.definition.execute({ taskId, summary: 'written' }, { agent: worker })
    await close.definition.execute({ taskId: created.taskId }, { agent: supervisor })
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
      /未授权|协同授权/,
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
      /未授权|协同授权/,
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


test('ordinary sessions are excluded from supervisor worker candidates and offers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-ordinary-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const registryPath = path.join(root, 'registry.json')
    fs.writeFileSync(registryPath, JSON.stringify({
      version: 1,
      sessions: {
        [PLAIN]: { sessionId: PLAIN, preset: 'standard', workdir: workspace, title: 'ordinary' },
      },
    }))
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath })
    const supervisor = harness.makeAgent(A, 'supervisor')
    const worker = harness.makeAgent(B, 'collab')
    const ordinary = harness.makeAgent(PLAIN, 'standard')
    await harness.emit('agent/created', { agent: supervisor, source: 'startup' })
    await harness.emit('agent/created', { agent: worker, source: 'startup' })
    await harness.emit('agent/created', { agent: ordinary, source: 'startup' })
    const admin = harness.ctx.get('collabAdmin')
    const board = admin.board(A)
    assert.deepEqual(board.workers.map(item => item.sessionId), [B])
    assert.throws(
      () => admin.panel(A, 'link', { worker: PLAIN, payload: { offer: true } }),
      /collaboration session/u,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('task open is explicit and task close rejects active subtasks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-task-open-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const supervisor = harness.makeAgent(A, 'supervisor')
    await harness.emit('agent/created', { agent: supervisor, source: 'startup' })
    const open = harness.tools.find(entry => entry.definition.name === 'collab_task_open')
    const create = harness.tools.find(entry => entry.definition.name === 'collab_task_create')
    const close = harness.tools.find(entry => entry.definition.name === 'collab_task_close')
    const cancel = harness.tools.find(entry => entry.definition.name === 'collab_task_cancel')
    const opened = JSON.parse(open.definition.execute({ title: 'Bounded task' }, { agent: supervisor }))
    const taskId = opened.task.taskId
    const parentList = JSON.parse(harness.tools.find(entry => entry.definition.name === 'collab_task_list')
      .definition.execute({}, { agent: supervisor }))
    assert.equal(parentList[0].taskId, taskId)
    assert.throws(() => create.definition.execute({
      title: 'Implicit parent',
      instruction: 'Must be rejected',
    }, { agent: supervisor }), /taskId is required/u)
    const created = JSON.parse(create.definition.execute({
      taskId,
      title: 'Pending subtask',
      instruction: 'Wait for cancellation',
    }, { agent: supervisor }))
    assert.throws(() => close.definition.execute({ taskId }, { agent: supervisor }), /active subtask/u)
    const subtaskList = harness.tools.find(entry => entry.definition.name === 'collab_subtasks')
      .definition.execute({}, { agent: supervisor })
    assert.match(subtaskList, /Pending subtask/u)
    cancel.definition.execute({ taskId: created.subtask.id }, { agent: supervisor })
    assert.match(close.definition.execute({ taskId }, { agent: supervisor }), /closed/u)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('authorization surfaces reject ordinary sessions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-auth-filter-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const registryPath = path.join(root, 'registry.json')
    fs.writeFileSync(registryPath, JSON.stringify({
      version: 1,
      sessions: {
        [PLAIN]: { sessionId: PLAIN, preset: 'standard', workdir: workspace, title: 'ordinary' },
      },
    }))
    const authorizationPath = path.join(root, 'authorization.json')
    fs.writeFileSync(authorizationPath, JSON.stringify({
      version: 2,
      grants: [
        { from: PLAIN, to: A }, { from: A, to: PLAIN },
        { from: A, to: B }, { from: B, to: A },
      ],
    }))
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath, authorizationPath })
    const supervisor = harness.makeAgent(A, 'supervisor')
    const worker = harness.makeAgent(B, 'collab')
    await harness.emit('agent/created', { agent: supervisor, source: 'startup' })
    await harness.emit('agent/created', { agent: worker, source: 'startup' })
    const admin = harness.ctx.get('collabAdmin')
    admin.authorize(A, B)
    assert.equal(admin.audit().some(entry => entry.event === 'authorization.authorize'), true)
    const listed = admin.listAuth()
    assert.deepEqual(listed.pairs.map(pair => [pair.a, pair.b]), [[A, B]])
    assert.deepEqual(listed.pending, [])
    const persisted = JSON.parse(fs.readFileSync(authorizationPath, 'utf8'))
    assert.equal(persisted.grants.some(grant => grant.from === PLAIN || grant.to === PLAIN), false)
    const authCommand = harness.commands.find(entry => entry.name === 'collab-auth')
    const refused = authCommand.handler({
      agent: supervisor,
      rawInput: `authorize ${PLAIN} ${A}`,
      attachments: [],
      signal: new AbortController().signal,
    })
    assert.equal(refused.kind, 'error')
    assert.match(refused.text, /known collaboration sessions/u)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('cancelling an accepted request cancels its subtasks and closes the task', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-request-cancel-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const supervisor = harness.makeAgent(A, 'supervisor')
    const worker = harness.makeAgent(B, 'collab')
    const requester = harness.makeAgent(E, 'collab')
    await harness.emit('agent/created', { agent: supervisor, source: 'startup' })
    await harness.emit('agent/created', { agent: worker, source: 'startup' })
    await harness.emit('agent/created', { agent: requester, source: 'startup' })
    const admin = harness.ctx.get('collabAdmin')
    admin.authorize(A, E)
    admin.panel(A, 'link', { worker: B, payload: { offer: true } })
    const submit = harness.tools.find(entry => entry.definition.name === 'collab_request_submit')
    const open = harness.tools.find(entry => entry.definition.name === 'collab_task_open')
    const create = harness.tools.find(entry => entry.definition.name === 'collab_subtask_create')
    const assign = harness.tools.find(entry => entry.definition.name === 'collab_subtask_assign')
    const accept = harness.tools.find(entry => entry.definition.name === 'collab_request_accept')
    const cancel = harness.tools.find(entry => entry.definition.name === 'collab_request_cancel')
    const submitted = JSON.parse(await submit.definition.execute({
      title: 'Cancelable work',
      requirement: 'Do work that may be cancelled',
    }, { agent: requester }))
    const opened = JSON.parse(open.definition.execute({ title: 'Cancelable task' }, { agent: supervisor }))
    const created = JSON.parse(create.definition.execute({
      taskId: opened.task.taskId,
      title: 'Cancelable subtask',
      instruction: 'Wait for cancellation',
    }, { agent: supervisor }))
    await assign.definition.execute({
      taskId: opened.task.taskId,
      subtaskId: created.subtask.id,
      worker: B,
    }, { agent: supervisor })
    await accept.definition.execute({
      requestId: submitted.request.id,
      taskId: opened.task.taskId,
    }, { agent: supervisor })
    await cancel.definition.execute({
      requestId: submitted.request.id,
    }, { agent: requester })
    const tasks = JSON.parse(harness.tools.find(entry => entry.definition.name === 'collab_task_list')
      .definition.execute({}, { agent: supervisor }))
    assert.equal(tasks[0].status, 'closed')
    const subtasks = harness.tools.find(entry => entry.definition.name === 'collab_subtasks')
      .definition.execute({}, { agent: supervisor })
    assert.match(subtasks, /\[cancelled\]/u)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('archiving a collaboration session removes its grants and relationships', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-archive-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const supervisor = harness.makeAgent(A, 'supervisor')
    const worker = harness.makeAgent(B, PRESET)
    await harness.emit('agent/created', { agent: supervisor, source: 'startup' })
    await harness.emit('agent/created', { agent: worker, source: 'startup' })
    const auth = harness.commands.find(command => command.name === 'collab-auth').handler
    const link = harness.commands.find(command => command.name === 'collab-link').handler
    const invocation = { agent: supervisor, attachments: [], signal: new AbortController().signal }
    await auth({ ...invocation, rawInput: `authorize ${A} ${B}` })
    await link({ ...invocation, rawInput: `link ${B} e30=` })
    const doctor = () => JSON.parse(harness.tools.find(entry => entry.definition.name === 'collab_doctor')
      .definition.execute({}, { agent: supervisor }))
    assert.equal(doctor().relationships, 1)
    assert.equal(doctor().grants, 2)
    await harness.emit('workspace/session-archived', { sessionId: B })
    assert.equal(doctor().relationships, 0)
    assert.equal(doctor().invalidGrants, 0)
    assert.equal(doctor().grants, 0)
    const registryFile = path.join(root, 'registry.json')
    assert.equal(JSON.parse(fs.readFileSync(registryFile, 'utf8')).sessions[B].archived, true)
    await harness.emit('workspace/session-unarchiving', { sessionId: B })
    assert.equal(JSON.parse(fs.readFileSync(registryFile, 'utf8')).sessions[B].archived, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the authorization snapshot exposes the complete collaboration directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-directory-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  try {
    const harness = fakeHarness(workspace)
    apply(harness.ctx, { registryPath: path.join(root, 'registry.json') })
    const supervisor = harness.makeAgent(A, 'supervisor')
    const one = harness.makeAgent(B, PRESET)
    const two = harness.makeAgent(D, PRESET)
    for (const agent of [supervisor, one, two]) await harness.emit('agent/created', { agent, source: 'startup' })
    const admin = harness.ctx.get('collabAdmin')
    const snapshot = admin.listAuth()
    assert.deepEqual(snapshot.sessions.map(entry => entry.sessionId).sort(), [A, B, D].sort())
    assert.equal(snapshot.sessions.every(entry => entry.archived === false), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
