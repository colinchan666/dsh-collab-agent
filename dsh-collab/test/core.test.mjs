import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  SessionRegistry, collabBaseOf, credentialPath, ensureCredential, ensureLayoutAt, ensureSessionLayout,
  findForeignAncestorAccess,
  findForeignSessionAccess, findForeignSessionAccessInCommand, findSuspiciousSearchPattern, inboxCount,
  listInbox, markRead, readJson, sendMessage, sessionWorkdir, withFileLock, writeJson,
} from '../lib/layout.js'
import { NoticeStore } from '../lib/notices.js'
import { TaskStore } from '../lib/tasks.js'
import { RequestStore } from '../lib/requests.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const SELF = 'session-11111111-1111-4111-8111-111111111111'
const PEER = 'session-22222222-2222-4222-8222-222222222222'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-test-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })
  const self = ensureSessionLayout({ originalCwd: workspace, sessionId: SELF, preset: 'collab', now: 1 })
  const peer = ensureSessionLayout({ originalCwd: workspace, sessionId: PEER, preset: 'collab', now: 2 })
  return { root, workspace, self, peer }
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true })
}

test('layout creates exactly comm and private under the session working directory', () => {
  const { root, workspace, self } = fixture()
  try {
    assert.equal(self.workdir, path.join(workspace, '.dsh-collab', 'sessions', SELF))
    assert.deepEqual(fs.readdirSync(self.workdir).sort(), ['comm', 'private', 'session.json'])
    assert.equal(fs.statSync(self.workdir).mode & 0o777, 0o700)
    assert.equal(fs.statSync(self.privateDir).mode & 0o777, 0o700)
    const meta = readJson(path.join(self.workdir, 'session.json'))
    assert.equal(meta.sessionId, SELF)
    assert.equal(meta.originalCwd, workspace)
    assert.ok(fs.readFileSync(path.join(workspace, '.dsh-collab', '.gitignore'), 'utf8').includes('*'))
  } finally {
    cleanup(root)
  }
})

test('a dedicated workspace directory gets comm and private directly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-dedicated-'))
  const base = path.join(root, 'base')
  const workdir = path.join(base, '.dsh-collab', 'sessions', 'generated-token')
  fs.mkdirSync(workdir, { recursive: true })
  try {
    assert.equal(collabBaseOf(workdir), base)
    const layout = ensureLayoutAt({ workdir, originalCwd: base, sessionId: SELF, preset: 'collab', now: 1 })
    assert.equal(layout.workdir, workdir)
    assert.deepEqual(fs.readdirSync(workdir).sort(), ['comm', 'private', 'session.json'])
    assert.equal(fs.statSync(layout.privateDir).mode & 0o777, 0o700)
    assert.ok(fs.existsSync(path.join(base, '.dsh-collab', '.gitignore')))
  } finally {
    cleanup(root)
  }
})

test('the pair credential is shared and stable in both comm directories', () => {
  const { root, self, peer } = fixture()
  try {
    const first = ensureCredential({ selfId: SELF, selfWorkdir: self.workdir, peerId: PEER, peerWorkdir: peer.workdir, now: 10 })
    const own = readJson(credentialPath(self.workdir, PEER))
    const remote = readJson(credentialPath(peer.workdir, SELF))
    assert.equal(own.token, first)
    assert.equal(remote.token, first)
    assert.equal(own.ownerSessionId, SELF)
    assert.equal(remote.ownerSessionId, PEER)
    assert.equal(own.createdAt, 10)
    const otherDirection = ensureCredential({ selfId: PEER, selfWorkdir: peer.workdir, peerId: SELF, peerWorkdir: self.workdir, now: 20 })
    assert.equal(otherDirection, first)
    assert.equal(readJson(credentialPath(self.workdir, PEER)).createdAt, 10)
  } finally {
    cleanup(root)
  }
})

test('send writes an outbox copy and an authenticated inbox copy', () => {
  const { root, self, peer } = fixture()
  try {
    const message = sendMessage({ selfId: SELF, selfWorkdir: self.workdir, peerId: PEER, peerWorkdir: peer.workdir, text: 'hello peer', now: 100 })
    const outbox = fs.readdirSync(path.join(self.workdir, 'comm', PEER, 'outbox'))
    const inbox = fs.readdirSync(path.join(peer.workdir, 'comm', SELF, 'inbox'))
    assert.equal(outbox.length, 1)
    assert.deepEqual(inbox, outbox)
    assert.equal(readJson(path.join(peer.workdir, 'comm', SELF, 'inbox', inbox[0])).text, 'hello peer')
    const received = listInbox({ selfId: PEER, selfWorkdir: peer.workdir })
    assert.equal(received.rejected, 0)
    assert.equal(received.messages.length, 1)
    assert.equal(received.messages[0].message.id, message.id)
    assert.equal(inboxCount(peer.workdir, SELF), 1)
    const archived = markRead(received.messages[0].file, peer.workdir)
    assert.ok(archived.includes(path.join('archive', 'inbox')))
    assert.equal(inboxCount(peer.workdir, SELF), 0)
    assert.equal(fs.readdirSync(path.join(peer.workdir, 'comm', SELF, 'archive', 'inbox')).length, 1)
    assert.equal(fs.existsSync(path.join(peer.workdir, 'comm', SELF, 'read')), false)
    const replay = path.join(peer.workdir, 'comm', SELF, 'inbox', path.basename(archived))
    fs.copyFileSync(archived, replay)
    const afterReplay = listInbox({ selfId: PEER, selfWorkdir: peer.workdir })
    assert.equal(afterReplay.messages.length, 0)
    assert.equal(afterReplay.rejected, 1)
  } finally {
    cleanup(root)
  }
})

test('legacy read/ archives inbound while normal outbox and archived outbox are restored', () => {
  const { root, self, peer } = fixture()
  try {
    const pair = path.join(self.workdir, 'comm', PEER)
    fs.mkdirSync(path.join(pair, 'read'), { recursive: true })
    fs.mkdirSync(path.join(pair, 'outbox'), { recursive: true })
    fs.mkdirSync(path.join(pair, 'archive', 'outbox'), { recursive: true })
    fs.writeFileSync(path.join(pair, 'read', 'received.json'), '{}')
    fs.writeFileSync(path.join(pair, 'outbox', 'sent.json'), '{}')
    fs.writeFileSync(path.join(pair, 'archive', 'outbox', 'previously-archived.json'), '{}')
    sendMessage({ selfId: SELF, selfWorkdir: self.workdir, peerId: PEER, peerWorkdir: peer.workdir, text: 'after migration', now: 42 })
    assert.equal(fs.existsSync(path.join(pair, 'read')), false)
    assert.deepEqual(
      fs.readdirSync(path.join(pair, 'archive', 'inbox')).sort(),
      ['received.json'],
    )
    const sent = fs.readdirSync(path.join(pair, 'outbox')).sort()
    assert.equal(sent.includes('sent.json'), true)
    assert.equal(sent.includes('previously-archived.json'), true)
    assert.equal(sent.length, 3)
    assert.equal(fs.existsSync(path.join(pair, 'archive', 'outbox')), false)
  } finally {
    cleanup(root)
  }
})

test('a tampered message is rejected by credential verification', () => {
  const { root, self, peer } = fixture()
  try {
    sendMessage({ selfId: SELF, selfWorkdir: self.workdir, peerId: PEER, peerWorkdir: peer.workdir, text: 'original', now: 100 })
    const inboxDir = path.join(peer.workdir, 'comm', SELF, 'inbox')
    const file = path.join(inboxDir, fs.readdirSync(inboxDir)[0])
    const stored = readJson(file)
    stored.text = 'tampered'
    writeJson(file, stored)
    const result = listInbox({ selfId: PEER, selfWorkdir: peer.workdir })
    assert.equal(result.messages.length, 0)
    assert.equal(result.rejected, 1)
  } finally {
    cleanup(root)
  }
})

test('private paths of another session are detected by every spelling', () => {
  const { root, self, peer } = fixture()
  try {
    const roots = [
      { sessionId: SELF, workdir: self.workdir },
      { sessionId: PEER, workdir: peer.workdir },
    ]
    const options = { selfId: SELF, selfWorkdir: self.workdir, roots }
    assert.equal(findForeignSessionAccess([peer.privateDir], options)?.sessionId, PEER)
    assert.equal(findForeignSessionAccess([credentialPath(peer.workdir, SELF)], options)?.sessionId, PEER)
    assert.equal(findForeignSessionAccess(['private/notes.md'], options), undefined)
    assert.equal(findForeignSessionAccess([self.privateDir], options), undefined)
    assert.equal(findForeignSessionAccess([credentialPath(self.workdir, PEER)], options), undefined)
    assert.equal(findForeignSessionAccess([['../', PEER, 'private', 'secret.txt'].join(path.sep)], options)?.sessionId, PEER)
    assert.equal(findForeignSessionAccessInCommand(`cat ${peer.privateDir}/secret.txt`, options)?.sessionId, PEER)
    assert.equal(findForeignSessionAccessInCommand('cat private/own.txt', options), undefined)
    assert.equal(findForeignSessionAccessInCommand(`cd ../${PEER} && cat private/x`, options)?.sessionId, PEER)
    assert.equal(findForeignSessionAccessInCommand('cat ../*/private/*', options)?.sessionId, '<wildcard>')
    assert.equal(findForeignAncestorAccess([path.join('..')], options)?.sessionId, PEER)
    assert.equal(findForeignAncestorAccess([self.workdir], options), undefined)
    assert.equal(findSuspiciousSearchPattern('../*/private/*', options)?.sessionId, '<pattern>')
    assert.equal(findSuspiciousSearchPattern('src/**/*.js', options), undefined)
  } finally {
    cleanup(root)
  }
})

test('two mismatched credential copies are refused instead of silently overwritten', () => {
  const { root, self, peer } = fixture()
  try {
    writeJson(credentialPath(self.workdir, PEER), {
      version: 1, ownerSessionId: SELF, peerSessionId: PEER, token: 'a'.repeat(64), createdAt: 1, updatedAt: 1,
    })
    writeJson(credentialPath(peer.workdir, SELF), {
      version: 1, ownerSessionId: PEER, peerSessionId: SELF, token: 'b'.repeat(64), createdAt: 1, updatedAt: 1,
    })
    assert.throws(
      () => ensureCredential({ selfId: SELF, selfWorkdir: self.workdir, peerId: PEER, peerWorkdir: peer.workdir }),
      /credential mismatch/,
    )
    assert.equal(readJson(credentialPath(self.workdir, PEER)).token, 'a'.repeat(64))
    assert.equal(readJson(credentialPath(peer.workdir, SELF)).token, 'b'.repeat(64))
  } finally {
    cleanup(root)
  }
})

test('a peer-initiated credential is adopted instead of replaced', () => {
  const { root, self, peer } = fixture()
  try {
    // The peer creates the pair first, as if it opened the conversation.
    const peerToken = ensureCredential({ selfId: PEER, selfWorkdir: peer.workdir, peerId: SELF, peerWorkdir: self.workdir, now: 5 })
    const adopted = ensureCredential({ selfId: SELF, selfWorkdir: self.workdir, peerId: PEER, peerWorkdir: peer.workdir, now: 6 })
    assert.equal(adopted, peerToken)
    assert.equal(readJson(credentialPath(self.workdir, PEER)).token, peerToken)
    assert.equal(readJson(credentialPath(peer.workdir, SELF)).token, peerToken)
  } finally {
    cleanup(root)
  }
})

test('a forged sender in an inbox copy is rejected', () => {
  const { root, self, peer } = fixture()
  try {
    const message = sendMessage({ selfId: SELF, selfWorkdir: self.workdir, peerId: PEER, peerWorkdir: peer.workdir, text: 'real', now: 100 })
    const peerInbox = path.join(peer.workdir, 'comm', SELF, 'inbox')
    const file = path.join(peerInbox, fs.readdirSync(peerInbox)[0])
    const stored = readJson(file)
    // Reuse a real MAC but claim a different sender.
    const forged = { ...stored, from: 'session-33333333-3333-4333-8333-333333333333' }
    writeJson(file, forged)
    assert.equal(message.from, SELF)
    const result = listInbox({ selfId: PEER, selfWorkdir: peer.workdir })
    assert.equal(result.messages.length, 0)
    assert.equal(result.rejected, 1)
  } finally {
    cleanup(root)
  }
})

test('a symlink into another private directory is resolved and rejected', () => {
  const { root, self, peer } = fixture()
  try {
    const secret = path.join(peer.privateDir, 'secret.txt')
    fs.writeFileSync(secret, 'top secret')
    const link = path.join(self.workdir, 'comm', 'link-to-secret.txt')
    try {
      fs.symlinkSync(secret, link, 'file')
    } catch {
      return // platform without symlink permission
    }
    const options = {
      selfId: SELF,
      selfWorkdir: self.workdir,
      roots: [{ sessionId: PEER, workdir: peer.workdir }],
    }
    assert.equal(findForeignSessionAccess([link], options)?.sessionId, PEER)
  } finally {
    cleanup(root)
  }
})

test('wildcard paths cannot enumerate every session private directory', () => {
  const { root, workspace, self, peer } = fixture()
  try {
    const options = {
      selfId: SELF,
      selfWorkdir: self.workdir,
      selfLayoutWorkdir: self.workdir,
      roots: [{ sessionId: PEER, workdir: peer.workdir }],
    }
    const foreign = path.join(workspace, '.dsh-collab', 'sessions', '*', 'private', '*')
    assert.equal(findForeignSessionAccess([foreign], options)?.sessionId, '<wildcard>')
    assert.equal(findForeignSessionAccessInCommand(`cat ${foreign}`, options)?.sessionId, '<wildcard>')
    const own = path.join(self.workdir, 'private', '*')
    assert.equal(findForeignSessionAccess([own], options), undefined)
  } finally {
    cleanup(root)
  }
})

test('cd into the sessions parent cannot escape through relative paths', () => {
  const { root, workspace, self, peer } = fixture()
  try {
    const options = {
      selfId: SELF,
      selfWorkdir: self.workdir,
      selfLayoutWorkdir: self.workdir,
      roots: [{ sessionId: PEER, workdir: peer.workdir }],
    }
    const sessions = path.join(workspace, '.dsh-collab', 'sessions')
    const command = `cd ${sessions} && cat ${PEER}/private/secret.txt`
    assert.equal(findForeignSessionAccessInCommand(command, { ...options, checkAncestors: true })?.sessionId, PEER)
  } finally {
    cleanup(root)
  }
})

test('a project can be bound to only one request', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-binding-'))
  try {
    const store = new TaskStore(path.join(root, 'tasks.json'))
    const project = store.createProject({ supervisor: SELF, title: 'bound' })
    assert.equal(project.requestId, null)
    store.bindProject(project.id, 'request-one')
    assert.equal(store.project(project.id).requestId, 'request-one')
    assert.throws(() => store.bindProject(project.id, 'request-two'), /another request/u)
    assert.equal(store.project(project.id).requestId, 'request-one')
  } finally {
    cleanup(root)
  }
})

test('two TaskStore instances preserve independent project writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-task-lock-'))
  try {
    const file = path.join(root, 'tasks.json')
    const first = new TaskStore(file)
    const second = new TaskStore(file)
    const one = first.createProject({ supervisor: SELF, title: 'one' })
    const two = second.createProject({ supervisor: SELF, title: 'two' })
    const fresh = new TaskStore(file)
    assert.ok(fresh.project(one.id))
    assert.ok(fresh.project(two.id))
  } finally {
    cleanup(root)
  }
})

test('two RequestStore instances preserve independent request writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-request-lock-'))
  try {
    const file = path.join(root, 'requests.json')
    const first = new RequestStore(file)
    const second = new RequestStore(file)
    const one = first.create({ requester: SELF, supervisor: PEER, title: 'one', requirement: 'one' })
    const two = second.create({ requester: SELF, supervisor: PEER, title: 'two', requirement: 'two' })
    const fresh = new RequestStore(file)
    assert.ok(fresh.get(one.id))
    assert.ok(fresh.get(two.id))
  } finally {
    cleanup(root)
  }
})

test('a stale state lock is recovered and a live lock times out', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-lock-'))
  try {
    const file = path.join(root, 'state.json')
    const lock = `${file}.lock`
    fs.writeFileSync(lock, 'stale')
    const old = new Date(Date.now() - 60_000)
    fs.utimesSync(lock, old, old)
    assert.equal(withFileLock(file, () => 'ok', { timeoutMs: 500, staleMs: 1000 }), 'ok')
    assert.equal(fs.existsSync(lock), false)
    fs.writeFileSync(lock, 'live')
    assert.throws(() => withFileLock(file, () => 'no', { timeoutMs: 20, staleMs: 60_000 }), /timed out/u)
    fs.unlinkSync(lock)
  } finally {
    cleanup(root)
  }
})

test('a malformed state file is backed up instead of silently overwritten', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-corrupt-'))
  try {
    const file = path.join(root, 'tasks.json')
    fs.writeFileSync(file, '{not json')
    const store = new TaskStore(file)
    assert.throws(() => store.read(), /corrupted/u)
    assert.equal(fs.existsSync(file), false)
    assert.ok(fs.readdirSync(root).some(name => name.startsWith('tasks.json.corrupt-')))
  } finally {
    cleanup(root)
  }
})

test('a cached store observes an external state write', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-cache-'))
  try {
    const file = path.join(root, 'tasks.json')
    const reader = new TaskStore(file)
    assert.equal(reader.listProjects(SELF).length, 0)
    const writer = new TaskStore(file)
    writer.createProject({ supervisor: SELF, title: 'external' })
    assert.equal(reader.listProjects(SELF).length, 1)
  } finally {
    cleanup(root)
  }
})

test('an accepted request can be cancelled and loses its execution deadline', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-cancel-'))
  try {
    const store = new RequestStore(path.join(root, 'requests.json'))
    const request = store.create({ requester: SELF, supervisor: PEER, title: 'cancel', requirement: 'cancel me' })
    store.accept(request.id, { projectId: 'project-1', executionDeadlineAt: Date.now() + 10000 })
    const cancelled = store.cancel(request.id, SELF)
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.executionDeadlineAt, null)
  } finally {
    cleanup(root)
  }
})

test('the notice outbox persists and removes queued wake-ups', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-notices-'))
  try {
    const store = new NoticeStore(path.join(root, 'notices.json'))
    const payload = { type: 'collab-task/assign', version: 1, taskId: 'task-1' }
    const notice = store.enqueue({ from: SELF, to: PEER, payload }, 10)
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0].payload.taskId, 'task-1')
    const failed = store.fail(notice.id, new Error('offline'), 20)
    assert.equal(failed.attempts, 1)
    assert.equal(failed.lastError, 'offline')
    assert.equal(store.prune(8 * 24 * 60 * 60 * 1000), true)
    assert.equal(store.list().length, 0)
    assert.equal(store.remove(notice.id), false)
    assert.equal(store.list().length, 0)
    const reopened = new NoticeStore(path.join(root, 'notices.json'))
    assert.equal(reopened.list().length, 0)
  } finally {
    cleanup(root)
  }
})

test('the registry discovers sessions under registered workspaces', () => {
  const { root, workspace } = fixture()
  try {
    const registryFile = path.join(root, 'registry.json')
    const registry = new SessionRegistry(registryFile)
    const supervisorId = 'session-33333333-3333-4333-8333-333333333333'
    ensureSessionLayout({ originalCwd: workspace, sessionId: supervisorId, preset: 'supervisor', now: 3 })
    assert.equal(registry.scanWorkspaces([workspace]), 3)
    assert.equal(registry.scanWorkspaces([workspace]), 0)
    const listed = registry.list()
    assert.deepEqual(listed.map(entry => entry.sessionId), [SELF, PEER, supervisorId])
    assert.equal(registry.get(supervisorId).preset, 'supervisor')
    assert.equal(registry.get(SELF).workdir, sessionWorkdir(workspace, SELF))
    registry.remove(PEER)
    assert.equal(registry.get(PEER), undefined)
  } finally {
    cleanup(root)
  }
})
