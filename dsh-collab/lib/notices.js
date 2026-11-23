/**
 * Durable at-least-once outbox for task/request protocol notices.
 *
 * The task and request stores are authoritative; a notice is only a wake-up
 * payload. Persisting it before delivery prevents a committed state change from
 * losing its notification when a peer workdir is temporarily unavailable.
 */
import crypto from 'node:crypto'

import { fileStamp, isSessionId, readStateJson, withFileLock, writeJson } from './layout.js'

const MAX_NOTICES = 500

function normalizeNotice(entry) {
  if (entry === null || typeof entry !== 'object') return undefined
  if (typeof entry.id !== 'string' || entry.id.length === 0 || entry.id.length > 128) return undefined
  if (!isSessionId(entry.from) || !isSessionId(entry.to)) return undefined
  if (entry.payload === null || typeof entry.payload !== 'object') return undefined
  return {
    id: entry.id,
    from: entry.from,
    to: entry.to,
    payload: entry.payload,
    createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
    updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
    attempts: Number.isInteger(entry.attempts) ? entry.attempts : 0,
    lastError: typeof entry.lastError === 'string' ? entry.lastError : null,
  }
}

/** Durable notice queue stored beside the request/task state. */
export class NoticeStore {
  constructor(file) {
    this.file = file
    this.state = undefined
  }

  read() {
    const stamp = fileStamp(this.file)
    if (this.state !== undefined && this.stamp === stamp) return this.state
    const raw = readStateJson(this.file)
    const source = raw?.notices !== null && typeof raw?.notices === 'object' ? raw.notices : {}
    const notices = {}
    for (const entry of Object.values(source)) {
      const normalized = normalizeNotice(entry)
      if (normalized !== undefined) notices[normalized.id] = normalized
    }
    this.state = { version: 1, notices }
    this.stamp = stamp
    return this.state
  }

  write(state) {
    this.state = state
    writeJson(this.file, { version: 1, notices: state.notices }, 0o600)
    this.stamp = fileStamp(this.file)
  }

  enqueue({ from, to, payload }, now = Date.now()) {
    if (!isSessionId(from) || !isSessionId(to) || from === to) {
      throw new Error('notice requires two different session ids')
    }
    if (payload === null || typeof payload !== 'object') throw new Error('notice payload must be an object')
    return withFileLock(this.file, () => {
    this.state = undefined
    const state = this.read()
    const id = `notice-${crypto.randomUUID()}`
    const notice = {
      id,
      from,
      to,
      payload,
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      lastError: null,
    }
    state.notices[id] = notice
    // Bound the queue; the oldest notice is dropped only after the cap is exceeded.
    const entries = Object.values(state.notices).sort((left, right) => left.createdAt - right.createdAt)
    while (entries.length > MAX_NOTICES) {
      const dropped = entries.shift()
      if (dropped !== undefined) delete state.notices[dropped.id]
    }
    this.write(state)
    return notice
    })
  }

  remove(id) {
    return withFileLock(this.file, () => {
      this.state = undefined
      const state = this.read()
      if (state.notices[id] === undefined) return false
      delete state.notices[id]
      this.write(state)
      return true
    })
  }

  fail(id, error, now = Date.now()) {
    return withFileLock(this.file, () => {
      this.state = undefined
      const state = this.read()
      const notice = state.notices[id]
      if (notice === undefined) return undefined
      notice.attempts += 1
      notice.lastError = String(error instanceof Error ? error.message : error)
      notice.updatedAt = now
      this.write(state)
      return notice
    })
  }

  prune(now = Date.now(), maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    return withFileLock(this.file, () => {
      this.state = undefined
      const state = this.read()
      let changed = false
      for (const [id, notice] of Object.entries(state.notices)) {
        if (now - notice.createdAt <= maxAgeMs) continue
        delete state.notices[id]
        changed = true
      }
      if (changed) this.write(state)
      return changed
    })
  }

  list() {
    return Object.values(this.read().notices)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(notice => ({ ...notice, payload: structuredClone(notice.payload) }))
  }
}
