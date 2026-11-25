import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createDeliveryManifestService } from '../lib/delivery-manifest.js'
import { mkdirp, writeJson } from '../lib/layout.js'

test('the delivery manifest module hashes files and publishes an alias', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-collab-manifest-'))
  try {
    const shared = path.join(root, 'shared')
    const artifact = path.join(shared, 'task-a', 'artifacts', 'result.txt')
    fs.mkdirSync(path.dirname(artifact), { recursive: true })
    fs.writeFileSync(artifact, 'hello')
    const tasks = { task: id => id === 'task-a' ? { id } : undefined }
    const service = createDeliveryManifestService({
      sharedRoot: shared, tasks, fs, path, crypto, mkdirp, writeJson,
      listDeliveryFiles: (directory) => {
        const files = []
        const walk = current => {
          for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name)
            if (entry.isDirectory()) walk(full)
            else files.push({ path: path.relative(directory, full), size: fs.statSync(full).size, modifiedAt: 0 })
          }
        }
        walk(directory)
        return files
      },
      warn: () => {},
    })
    const manifest = service.buildDeliveryManifest('task-a')
    assert.equal(manifest.files.length, 1)
    assert.match(manifest.files[0].sha256, /^[0-9a-f]{64}$/u)
    const alias = service.publishDeliveryAlias('task-a', 'delivery-a')
    assert.equal(fs.readlinkSync(alias), path.join(shared, 'task-a', 'artifacts'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
