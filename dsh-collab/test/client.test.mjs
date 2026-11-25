import assert from 'node:assert/strict'
import test from 'node:test'

let definition
globalThis.window = {
  __ModuleLoader__: {
    load(value) { definition = value },
  },
}
await import('../client.js')

function fakeClientHarness() {
  const sessions = { ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }
  const listeners = new Set()
  const registrations = []
  const calls = { started: [], opened: [], openedWorkspace: [], executed: [], auth: [], registered: [], panels: [], tabs: [], tabTypes: [] }
  const ctx = {
    effect(factory) {
      factory()
      return () => {}
    },
    locale: {
      register() { return () => {} },
      bind() { return key => key },
    },
    slots: {
      inject(_name, callback) { callback() },
      register(options, component) { registrations.push({ options, component }); return () => {} },
    },
    uiWorkspace: {
      startSession(workspaceId, options) { calls.started.push({ workspaceId, options }) },
      openWorkspace(workspaceId, beforeOpen, options) { calls.openedWorkspace.push({ workspaceId, beforeOpen, options }) },
      openSession(id) {
        calls.opened.push(id)
        calls.onOpen?.(id)
      },
    },
    workspaces: {
      async create(input) {
        calls.created.push(input)
        return { workspaceId: 'ws-1', path: input.path, title: 'token' }
      },
      async rename(id, title) {
        calls.renamed.push({ id, title })
        return { workspaceId: id, path: 'x', title }
      },
      async delete(id) { calls.deleted.push(id) },
    },
    layout: { selectPanel(id) { calls.panels.push(id) } },
    sidebarRight: { isExpanded: () => false, openTab(kind, options) { calls.tabs.push({ kind, options }) } },
    sidebarRightTabs: { register(definition) { calls.tabTypes.push(definition); return () => {} } },
    uiConversation: { events: { register(definition) { calls.registered.push(definition); return () => {} } } },
    remote: {
      commands: {
        async execute(...args) {
          calls.executed.push(args)
          return { ok: true, value: { result: { kind: 'success', text: JSON.stringify({ pairs: [] }) } } }
        },
      },
      collabAuth: {
        async list() {
          calls.auth.push(['list'])
          return { ok: true, value: { pairs: [], pending: [] } }
        },
        async authorize(a, b) {
          calls.auth.push(['authorize', a, b])
          return { ok: true, value: { pairs: [], pending: [] } }
        },
        async revoke(a, b) {
          calls.auth.push(['revoke', a, b])
          return { ok: true, value: { pairs: [], pending: [] } }
        },
        async panel(sessionId, operation, argsJson) {
          calls.auth.push(['panel', sessionId, operation, argsJson])
          return { ok: true, value: '{}' }
        },
      },
    },
    sessions: {
      list: {
        getSnapshot: () => sessions,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      },
      async create(options) { calls.sessionCreate = options; return 'session-new' },
    },
  }
  return { ctx, calls, sessions, listeners, registrations }
}

const React = {
  createElement: () => null,
  Fragment: Symbol('Fragment'),
  useState: () => [null, () => {}],
}

function pluginFor() {
  return definition.factory(name => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
}

test('the client starts a collab session through the current-workspace navigation', async () => {
  const plugin = pluginFor()
  const harness = fakeClientHarness()
  plugin.apply(harness.ctx)
  const registration = harness.registrations.find(entry => entry.options.name === 'sidebar.session.action')
  assert.ok(registration)
  const face = registration.options.inject()
  face.start()
  face.start('supervisor')
  assert.deepEqual(harness.calls.started, [{
    workspaceId: undefined,
    options: { agentPreset: 'collab' },
  }, {
    workspaceId: undefined,
    options: { agentPreset: 'supervisor' },
  }])
  assert.ok(harness.registrations.some(entry => (
    entry.options.name === 'sidebar.panellist' && entry.options.id === 'collab-auth'
  )))
  const panel = harness.registrations.find(entry => (
    entry.options.name === 'main' && entry.options.key === 'collab-auth'
  ))
  assert.ok(panel)
  const panelFace = panel.options.inject()
  assert.equal(typeof panelFace.auth.list, 'function')
  const result = await panelFace.auth.list()
  assert.equal(result.ok, true)
  assert.deepEqual(harness.calls.auth, [['list']])
  assert.ok(harness.calls.registered.some(definition => definition.kind === 'collab-auth-refused'))
  assert.ok(harness.registrations.some(entry => (
    entry.options.name === 'conversation.chat.turnTail' && entry.options.id === 'collab-auth-refused'
  )))
  for (const [name, id] of [
    ['shell.overlay', 'collab-base-prompt'],
    ['shell.overlay', 'collab-preset-menu-filter'],
    ['conversation.hero.options', 'collab-preset-lock'],
    ['sidebar.workspaces.session.menu.item', 'collab-base-prompt'],
  ]) {
    assert.ok(harness.registrations.some(entry => entry.options.name === name && entry.options.id === id), `${name}:${id}`)
  }
  assert.ok(harness.calls.tabTypes.some(entry => entry.kind === 'collabSupervisorTasks'))
  assert.ok(harness.calls.tabTypes.some(entry => entry.kind === 'collabSupervisorWorkers'))
  assert.ok(harness.registrations.some(entry => entry.options.name === 'sidebar.right.pane.tab' && entry.options.key === '@xmodelin/dsh-collab-sessions/supervisor-tasks'))
  assert.ok(harness.registrations.some(entry => entry.options.name === 'sidebar.right.pane.tab' && entry.options.key === '@xmodelin/dsh-collab-sessions/supervisor-workers'))
  const board = harness.registrations.find(entry => (
    entry.options.name === 'sidebar.right.pane.tab'
    && entry.options.key === '@xmodelin/dsh-collab-sessions/supervisor-tasks'
  ))
  const boardFace = board.options.inject()
  const boardResult = await boardFace.panel('session-supervisor', 'board', {})
  assert.equal(boardResult.ok, true)
  assert.deepEqual(harness.calls.auth.at(-1), ['panel', 'session-supervisor', 'board', '{}'])
})

test('the auth-refusal turn projection records a collab_send refusal', () => {
  const harness = fakeClientHarness()
  pluginFor().apply(harness.ctx)
  const definition = harness.calls.registered.find(entry => entry.kind === 'collab-auth-refused')
  assert.ok(definition)
  let state = definition.start({}, { event: { type: 'turn/start', data: { turn: 7 } } })
  state = definition.update({ state }, {
    event: { type: 'tool/call', data: { turn: 7, callId: 'call-1', name: 'collab_send' } },
  })
  state = definition.update({ state }, {
    event: {
      type: 'tool/result',
      data: {
        turn: 7,
        message: {
          source: { callId: 'call-1' },
          isError: true,
          content: [{ type: 'text', text: '未授权：请在“协同授权”页授权双方。' }],
        },
      },
    },
  })
  const location = definition.buildLocationData({ state }, 'turn')
  assert.equal(location.value.message, '未授权：请在“协同授权”页授权双方。')
})

test('the client does not auto-open a collab session when it starts running', async () => {
  const plugin = pluginFor()
  const harness = fakeClientHarness()
  plugin.apply(harness.ctx)
  const notify = () => { for (const listener of harness.listeners) listener() }
  harness.sessions.ids = ['session-collab']
  harness.sessions.byId = {
    'session-collab': { id: 'session-collab', running: false, projectionValues: { agentPreset: 'collab' } },
  }
  harness.sessions.projectionsBySession = { 'session-collab': { values: { agentPreset: 'collab' } } }
  notify()
  harness.sessions.byId['session-collab'] = { ...harness.sessions.byId['session-collab'], running: true }
  notify()
  assert.deepEqual(harness.calls.opened, [])
})




test('base prompt command parsing allows an empty value', () => {
  const { __test } = pluginFor()
  assert.deepEqual(__test.parseBasePromptCommand('/collab-base set'), { operation: 'baseSet', value: '' })
  assert.deepEqual(__test.parseBasePromptCommand('/collab-base set '), { operation: 'baseSet', value: '' })
  assert.deepEqual(__test.parseBasePromptCommand('/collab-base set aGVsbG8='), { operation: 'baseSet', value: 'hello' })
  assert.equal(__test.parseBasePromptCommand('/collab-base set %%%'), null)
})


test('ordinary summaries are not collaboration summaries', () => {
  const plugin = pluginFor()
  const { isCollabSummary } = plugin.__test
  assert.equal(isCollabSummary({ id: 'plain', projectionValues: { agentPreset: 'standard' } }), false)
  assert.equal(isCollabSummary({
    id: 'plain',
    projectionValues: {
      agentPreset: 'standard',
      workingDirectory: '/workspace/' + ['.dsh-collab', 'sessions', 'plain'].join('/'),
    },
  }), false)
  assert.equal(isCollabSummary({ id: 'worker', projectionValues: { agentPreset: 'collab' } }), true)
})

test('workspace switching preserves the active collaboration preset', () => {
  const plugin = pluginFor()
  const harness = fakeClientHarness()
  harness.sessions.byId['session-collab'] = {
    id: 'session-collab',
    retainedBy: { mainView: 1 },
    projectionValues: { agentPreset: 'collab' },
  }
  plugin.apply(harness.ctx)
  harness.ctx.uiWorkspace.openWorkspace('ws-target')
  assert.deepEqual(harness.calls.openedWorkspace, [{
    workspaceId: 'ws-target',
    beforeOpen: undefined,
    options: { agentPreset: 'collab' },
  }])
  harness.ctx.uiWorkspace.openWorkspace('ws-target', undefined, {})
  assert.deepEqual(harness.calls.openedWorkspace[1], {
    workspaceId: 'ws-target',
    beforeOpen: undefined,
    options: {},
  })
})


test('the compatibility selectors stay explicit and centralized', () => {
  const { COMPAT } = pluginFor().__test
  assert.equal(COMPAT.labels.collab, '协同会话')
  assert.equal(COMPAT.labels.supervisor, '超级会话')
  assert.equal(COMPAT.presetText.test('Collab session'), true)
  assert.match(COMPAT.modeChip, /Agent 预设/u)
})
