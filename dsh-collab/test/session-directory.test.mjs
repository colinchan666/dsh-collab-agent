import assert from 'node:assert/strict'
import test from 'node:test'

import { createSessionDirectory } from '../lib/session-directory.js'

test('the session directory is the single metadata projection', () => {
  const registry = new Map([
    ['session-a', { sessionId: 'session-a', preset: 'supervisor', title: 'A' }],
    ['session-b', { sessionId: 'session-b', preset: 'collab', title: null }],
  ])
  const sessions = new Map([
    ['session-b', { id: 'session-b' }],
  ])
  const directory = createSessionDirectory({
    registry: { get: id => registry.get(id), list: () => [...registry.values()] },
    sessions: { get: id => sessions.get(id) },
    sessionTitle: { get: session => ({ title: `live-${session.id}` }) },
    agents: { get: () => undefined },
  })
  assert.deepEqual(directory.get('session-a'), {
    sessionId: 'session-a', title: 'A', preset: 'supervisor', archived: false, online: false, workspace: null,
  })
  assert.equal(directory.get('session-b').title, 'live-session-b')
  assert.equal(directory.getMany(['session-a', 'session-missing']).size, 1)
  assert.equal(directory.list().length, 2)
})

test('the session directory hydrates titles from persisted session queries', async () => {
  const registry = new Map([
    ['session-a', { sessionId: 'session-a', preset: 'collab', title: null, archived: true }],
  ])
  const directory = createSessionDirectory({
    registry: { get: id => registry.get(id), list: () => [...registry.values()] },
    sessions: { get: () => undefined },
    sessionTitle: { get: () => undefined },
    sessionQuery: { readTitle: async id => ({ title: `persisted-${id}` }) },
    agents: { get: () => undefined },
  })
  await directory.hydrate()
  assert.equal(directory.get('session-a').title, 'persisted-session-a')
  assert.equal(directory.get('session-a').archived, true)
})

test('the session directory merges the workspace archive set', () => {
  const registry = new Map([
    ['session-a', { sessionId: 'session-a', preset: 'collab', title: 'A' }],
  ])
  const directory = createSessionDirectory({
    registry: { get: id => registry.get(id), list: () => [...registry.values()] },
    sessions: { get: () => undefined },
    sessionTitle: { get: () => undefined },
    archivedSessionIds: () => new Set(['session-a']),
    agents: { get: () => undefined },
  })
  assert.equal(directory.get('session-a').archived, true)
})

test('the session directory hydrates presets from session queries', async () => {
  const registry = new Map([
    ['session-a', { sessionId: 'session-a', workdir: '/tmp/a' }],
  ])
  const directory = createSessionDirectory({
    registry: { get: id => registry.get(id), list: () => [...registry.values()] },
    sessions: { get: () => undefined },
    sessionTitle: { get: () => undefined },
    sessionQuery: {
      readTitle: async () => undefined,
      inspectSession: async (id, read) => read({ id }),
    },
    agentPresets: { presetForSession: () => 'supervisor' },
    agents: { get: () => undefined },
  })
  await directory.hydrate()
  assert.equal(directory.get('session-a').preset, 'supervisor')
})

