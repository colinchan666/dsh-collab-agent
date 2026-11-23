import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../lib/host.js'

function harness() {
  let service
  let invocation
  const admin = {
    listAuth: () => ({ pairs: [], pending: [] }),
    authorize: () => ({ pairs: [], pending: [] }),
    revoke: () => ({ pairs: [], pending: [] }),
    panel: (sessionId, operation, args) => ({ sessionId, operation, args }),
  }
  const ctx = {
    get: name => name === 'collabAdmin' ? admin : undefined,
    provide: (name, value) => { if (name === 'collabAuth') service = value },
    get invocation() { return invocation },
    set invocation(value) { invocation = value },
  }
  apply(ctx)
  return { ctx, service: () => service }
}

test('the management Remote is owner-only', () => {
  const { ctx, service } = harness()
  assert.deepEqual(service().list(), { pairs: [], pending: [] })
  ctx.invocation = { peer: { principal: { kind: 'peer' } } }
  assert.throws(() => service().list(), /owner-only/u)
  assert.throws(() => service().panel('session-11111111-1111-4111-8111-111111111111', 'baseGet', '{}'), /owner-only/u)
  ctx.invocation = undefined
  assert.equal(
    service().panel('session-11111111-1111-4111-8111-111111111111', 'baseGet', '{}'),
    JSON.stringify({ sessionId: 'session-11111111-1111-4111-8111-111111111111', operation: 'baseGet', args: {} }),
  )
})

test('panel args are parsed and malformed data is rejected', () => {
  const { service } = harness()
  const id = 'session-11111111-1111-4111-8111-111111111111'
  assert.throws(() => service().panel(id, 'baseSet', '{bad'), /JSON/u)
  assert.throws(() => service().panel(id, 'baseSet', '[]'), /JSON object/u)
  const output = JSON.parse(service().panel(id, 'baseSet', JSON.stringify({ value: 'x' })))
  assert.equal(output.args.value, 'x')
})
