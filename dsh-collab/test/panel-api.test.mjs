import assert from 'node:assert/strict'
import test from 'node:test'

import { createPanelApi } from '../lib/panel-api.js'

test('the panel facade maps typed calls onto the JSON operation transport', () => {
  const calls = []
  const api = createPanelApi((sessionId, operation, args) => {
    calls.push({ sessionId, operation, args })
    return { sessionId, operation, args }
  })
  assert.equal(api.board('session-a').operation, 'board')
  assert.deepEqual(api.link('session-a', 'worker-b', { offer: true }).args, {
    worker: 'worker-b', payload: { offer: true },
  })
  assert.deepEqual(api.baseSet('session-a', 'value').args, { value: 'value' })
  assert.deepEqual(calls.map(call => call.operation), ['board', 'link', 'baseSet'])
})
