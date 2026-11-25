import assert from 'node:assert/strict'
import test from 'node:test'

import { collectHealth } from '../lib/health.js'

test('the health projection counts invalid collaboration state', () => {
  const health = collectHealth({
    sessionId: 'session-a',
    registryEntries: [
      { sessionId: 'session-a', preset: 'supervisor' },
      { sessionId: 'session-b', preset: 'collab' },
      { sessionId: 'session-c', preset: 'standard' },
    ],
    relationships: [
      { supervisor: 'session-a', worker: 'session-b' },
      { supervisor: 'session-a', worker: 'session-c' },
    ],
    grants: [
      { from: 'session-a', to: 'session-b' },
      { from: 'session-a', to: 'session-c' },
    ],
    tasks: [{ status: 'open' }, { status: 'closed' }],
    requests: [{ supervisor: 'session-a', status: 'accepted' }],
    auditEntries: 3,
    isSupervisor: true,
  })
  assert.equal(health.invalidRelationships, 1)
  assert.equal(health.invalidGrants, 1)
  assert.equal(health.activeTasks, 1)
  assert.equal(health.activeRequests, 1)
})
