import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AuditLog } from '../lib/audit.js'

test('the audit log appends JSON lines and returns a bounded tail', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-audit-'))
  try {
    const file = path.join(root, 'audit.jsonl')
    const audit = new AuditLog(file)
    for (let index = 0; index < 20; index += 1) audit.append('test.event', { index })
    const tail = audit.tail(5)
    assert.equal(tail.length, 5)
    assert.deepEqual(tail.map(entry => entry.index), [15, 16, 17, 18, 19])
    assert.equal(tail[0].event, 'test.event')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
