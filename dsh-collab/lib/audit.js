/** Append-only collaboration audit log for human and supervisor actions. */
import fs from 'node:fs'
import path from 'node:path'

import { mkdirp } from './layout.js'

export class AuditLog {
  constructor(file) {
    this.file = file
  }

  append(event, fields = {}) {
    try {
      mkdirp(path.dirname(this.file), 0o700)
      fs.appendFileSync(this.file, `${JSON.stringify({ at: Date.now(), event, ...fields })}\n`, { mode: 0o600 })
    } catch {
      // Audit is advisory; a full read-only disk must not break collaboration.
    }
  }

  tail(limit = 100) {
    try {
      const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean)
      return lines.slice(Math.max(0, lines.length - Math.max(1, Math.min(limit, 500))))
        .map(line => {
          try { return JSON.parse(line) } catch { return { event: 'audit.invalid', raw: line } }
        })
    } catch {
      return []
    }
  }
}
