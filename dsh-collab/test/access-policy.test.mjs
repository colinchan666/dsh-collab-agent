import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createAccessPolicy } from '../lib/access-policy.js'

test('the access policy recognizes supervisor delivery reads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-access-'))
  try {
    const sharedRoot = path.join(root, 'shared')
    const artifact = path.join(sharedRoot, 'task-a', 'artifacts', 'result.txt')
    fs.mkdirSync(path.dirname(artifact), { recursive: true })
    fs.writeFileSync(artifact, 'x')
    const task = { id: 'task-a', status: 'open', supervisor: 'session-s', requestId: 'request-a' }
    const tasks = {
      task: id => id === 'task-a' ? task : undefined,
      listForWorker: id => id === 'session-w' ? [{ taskId: 'task-a', supervisor: 'session-s' }] : [],
    }
    const requests = {
      listForRequester: id => id === 'session-r'
        ? [{ id: 'request-a', taskId: 'task-a', status: 'delivered', delivery: { deliveryId: 'd' } }]
        : [],
    }
    const supervisor = createAccessPolicy({
      sharedRoot, sessionId: 'session-s', selfWorkdir: root, layoutWorkdir: root,
      tasks, requests, isSupervisorSession: id => id === 'session-s', isManagedWorker: () => false,
    })
    assert.equal(supervisor.deliveryAccessFor(artifact, false), true)
    assert.equal(supervisor.deliveryAccessFor(artifact, true), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
