import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { apply } from '../lib/host.js'

function harness() {
  let service
  let invocation
  const admin = {
    listAuth: () => ({ pairs: [], pending: [] }),
    authorize: () => ({ pairs: [], pending: [] }),
    revoke: () => ({ pairs: [], pending: [] }),
    panel: (sessionId, operation, args) => ({ sessionId, operation, args }),
    board: sessionId => ({ board: sessionId }),
    link: (sessionId, worker, payload) => ({ link: { sessionId, worker, payload } }),
    unlink: (sessionId, worker) => ({ unlink: { sessionId, worker } }),
    pin: (sessionId, worker) => ({ pin: { sessionId, worker } }),
    live: (sessionId, worker) => ({ live: { sessionId, worker } }),
    baseGet: sessionId => ({ baseGet: sessionId }),
    baseSet: (sessionId, value) => ({ baseSet: { sessionId, value } }),
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


test('the packaged runtime describes session resources and the client carries panel', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.main, 'lib/index.js')
  assert.equal(manifest.files.includes('lib/index.js'), true)
  const host = fs.readFileSync(path.join(root, 'lib/index.js'), 'utf8')
  assert.match(host, /resources: \{ session:/u)
  assert.match(host, /assertOwner\(\)/u)
  const bundle = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8')
  assert.match(bundle, /collabAuth\/panel/u)
  assert.ok(bundle.length < 600_000)
})


test('typed panel Remote methods preserve the owner-only boundary', () => {
  const { ctx, service } = harness()
  const id = 'session-11111111-1111-4111-8111-111111111111'
  const worker = 'session-22222222-2222-4222-8222-222222222222'
  assert.equal(JSON.parse(service().board(id)).board, id)
  assert.deepEqual(JSON.parse(service().link(id, worker, JSON.stringify({ offer: true }))).link.payload, { offer: true })
  assert.equal(JSON.parse(service().baseGet(id)).baseGet, id)
  ctx.invocation = { peer: { principal: { kind: 'peer' } } }
  assert.throws(() => service().board(id), /owner-only/u)
})

test('the generated host artifact exposes every typed panel method', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const host = fs.readFileSync(path.join(root, 'lib/typert.host.js'), 'utf8')
  for (const method of ['board', 'link', 'unlink', 'pin', 'live', 'baseGet', 'baseSet']) {
    assert.match(host, new RegExp(`collabAuth/${method}`, 'u'))
  }
})
