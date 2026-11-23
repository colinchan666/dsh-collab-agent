/**
 * Explicit, bilateral session-pair authorization for collaboration messaging.
 *
 * A grant is directional: `from` authorizes communicating with `to`. Two
 * sessions may exchange messages only when BOTH directions exist. A single
 * side's grant is therefore never sufficient, and the management page shows
 * such one-sided grants as pending until the other side is granted.
 */
import path from 'node:path'

import { fileStamp, isSessionId, readStateJson, withFileLock, writeJson } from './layout.js'

/** Stable key for a directed grant. */
export function grantKey(from, to) {
  return `${from}\u0000${to}`
}

/** Stable key for an unordered pair; stored with the smaller id first. */
export function pairKey(a, b) {
  return [a, b].sort().join('\u0000')
}

function normalizeGrants(raw) {
  const grants = []
  const seen = new Set()
  const add = (entry) => {
    if (!isSessionId(entry?.from) || !isSessionId(entry?.to) || entry.from === entry.to) return
    const key = grantKey(entry.from, entry.to)
    if (seen.has(key)) return
    seen.add(key)
    grants.push({
      from: entry.from,
      to: entry.to,
      createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
      updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
      ...(typeof entry.authorizedBy === 'string' ? { authorizedBy: entry.authorizedBy } : {}),
    })
  }
  if (Array.isArray(raw?.grants)) {
    for (const entry of raw.grants) add(entry)
    return grants
  }
  // Version 1 stored one symmetric pair record. Preserve it as both
  // directions so an already-authorized pair keeps working.
  if (Array.isArray(raw?.pairs)) {
    for (const entry of raw.pairs) {
      if (!isSessionId(entry?.a) || !isSessionId(entry?.b) || entry.a === entry.b) continue
      add({ from: entry.a, to: entry.b, createdAt: entry.createdAt, updatedAt: entry.updatedAt, authorizedBy: entry.authorizedBy })
      add({ from: entry.b, to: entry.a, createdAt: entry.createdAt, updatedAt: entry.updatedAt, authorizedBy: entry.authorizedBy })
    }
  }
  return grants
}

/** Durable set of directed authorization grants. */
export class AuthorizationStore {
  constructor(file) {
    this.file = file
    this.state = undefined
  }

  read() {
    const stamp = fileStamp(this.file)
    if (this.state !== undefined && this.stamp === stamp) return this.state
    this.state = { version: 2, grants: normalizeGrants(readStateJson(this.file)) }
    this.stamp = stamp
    return this.state
  }

  write(state) {
    this.state = state
    writeJson(this.file, { version: 2, grants: state.grants })
    this.stamp = fileStamp(this.file)
  }

  /** Every directional grant, for the management page and audit. */
  listGrants() {
    return this.read().grants
      .map(entry => ({ ...entry }))
      .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0))
  }

  /** Pairs where both directions exist. */
  listPairs() {
    const grants = this.read().grants
    const keys = new Set(grants.map(entry => grantKey(entry.from, entry.to)))
    const pairs = []
    const seen = new Set()
    for (const grant of grants) {
      if (!keys.has(grantKey(grant.to, grant.from))) continue
      const key = pairKey(grant.from, grant.to)
      if (seen.has(key)) continue
      seen.add(key)
      const [a, b] = [grant.from, grant.to].sort()
      const reverse = grants.find(entry => entry.from === b && entry.to === a)
      pairs.push({
        a,
        b,
        createdAt: Math.min(grant.createdAt ?? 0, reverse?.createdAt ?? 0),
        updatedAt: Math.max(grant.updatedAt ?? 0, reverse?.updatedAt ?? 0),
      })
    }
    return pairs
  }

  /** One-sided grants whose reverse direction is still missing. */
  listPending() {
    const grants = this.read().grants
    const keys = new Set(grants.map(entry => grantKey(entry.from, entry.to)))
    return grants
      .filter(grant => !keys.has(grantKey(grant.to, grant.from)))
      .map(grant => ({ ...grant }))
      .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0))
  }

  hasGrant(from, to) {
    if (!isSessionId(from) || !isSessionId(to) || from === to) return false
    return this.read().grants.some(entry => entry.from === from && entry.to === to)
  }

  /** Communication requires both directions. */
  isAuthorized(a, b) {
    if (!isSessionId(a) || !isSessionId(b) || a === b) return false
    return this.hasGrant(a, b) && this.hasGrant(b, a)
  }

  grant(from, to, authorizedBy, now = Date.now()) {
    if (!isSessionId(from) || !isSessionId(to) || from === to) {
      throw new Error('grant requires two different session ids')
    }
    return withFileLock(this.file, () => {
    this.state = undefined
    const state = this.read()
    const existing = state.grants.find(entry => entry.from === from && entry.to === to)
    if (existing !== undefined) {
      if (typeof authorizedBy === 'string') existing.authorizedBy = authorizedBy
      existing.updatedAt = now
      this.write(state)
      return existing
    }
    const grant = {
      from,
      to,
      createdAt: now,
      updatedAt: now,
      ...(typeof authorizedBy === 'string' ? { authorizedBy } : {}),
    }
    state.grants.push(grant)
    this.write(state)
    return grant
    })
  }

  /** Grant both directions in one explicit bilateral action. */
  authorize(a, b, authorizedBy, now = Date.now()) {
    if (!isSessionId(a) || !isSessionId(b) || a === b) {
      throw new Error('authorize requires two different session ids')
    }
    this.grant(a, b, authorizedBy, now)
    this.grant(b, a, authorizedBy, now)
    return this.listPairs().find(pair => pairKey(pair.a, pair.b) === pairKey(a, b))
  }

  revokeGrant(from, to) {
    return withFileLock(this.file, () => {
      this.state = undefined
      const state = this.read()
      const next = state.grants.filter(entry => !(entry.from === from && entry.to === to))
      if (next.length === state.grants.length) return false
      this.write({ ...state, grants: next })
      return true
    })
  }

  /** Revoke both directions. */
  revoke(a, b) {
    if (!isSessionId(a) || !isSessionId(b)) return false
    const revokedOne = this.revokeGrant(a, b)
    const revokedOther = this.revokeGrant(b, a)
    return revokedOne || revokedOther
  }
}

/** Path of the authorization document beside the session registry. */
export function authorizationPathFor(registryPath) {
  return path.join(path.dirname(registryPath), 'authorization.json')
}
