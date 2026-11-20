import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AuthorizationStore, pairKey } from '../lib/auth.js'

const A = 'session-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'session-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'session-cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-auth-'))
  return { root, file: path.join(root, 'authorization.json') }
}

test('communication requires grants in both directions', () => {
  const { root, file } = fixture()
  try {
    const store = new AuthorizationStore(file)
    assert.equal(store.isAuthorized(A, B), false)
    store.grant(A, B, 'human', 10)
    assert.equal(store.hasGrant(A, B), true)
    assert.equal(store.hasGrant(B, A), false)
    assert.equal(store.isAuthorized(A, B), false)
    assert.equal(store.listPairs().length, 0)
    assert.equal(store.listPending().length, 1)
    store.grant(B, A, 'human', 20)
    assert.equal(store.isAuthorized(A, B), true)
    assert.equal(store.isAuthorized(B, A), true)
    assert.equal(store.listPairs().length, 1)
    assert.equal(store.listPending().length, 0)
    assert.equal(pairKey(B, A), pairKey(A, B))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('authorize grants both directions; revoke removes both and persists', () => {
  const { root, file } = fixture()
  try {
    const store = new AuthorizationStore(file)
    store.authorize(A, B, 'human', 10)
    assert.equal(store.isAuthorized(A, B), true)
    assert.equal(store.listGrants().length, 2)
    const reloaded = new AuthorizationStore(file)
    assert.equal(reloaded.isAuthorized(B, A), true)
    assert.equal(reloaded.listPairs().length, 1)
    assert.equal(reloaded.listPairs()[0].a, A)
    assert.equal(store.revoke(B, A), true)
    assert.equal(store.isAuthorized(A, B), false)
    assert.equal(new AuthorizationStore(file).listGrants().length, 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a version-1 symmetric pair migrates to both grants', () => {
  const { root, file } = fixture()
  try {
    fs.writeFileSync(file, JSON.stringify({ version: 1, pairs: [{ a: A, b: B, createdAt: 1 }] }))
    const store = new AuthorizationStore(file)
    assert.equal(store.isAuthorized(A, B), true)
    assert.equal(store.listPairs().length, 1)
    assert.equal(store.listGrants().length, 2)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('authorization rejects bad grants', () => {
  const { root, file } = fixture()
  try {
    const store = new AuthorizationStore(file)
    assert.throws(() => store.grant(A, A), /two different/)
    assert.throws(() => store.grant('../x', B), /two different/)
    assert.equal(store.isAuthorized(A, A), false)
    assert.equal(store.isAuthorized(A, C), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
