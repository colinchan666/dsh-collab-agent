/**
 * Supervisor-worker relationships: authorization flags plus an optional
 * human-pinned capability override. The worker's live capability is derived
 * by the Host, so a base-prompt update never silently keeps a stale snapshot.
 */
import { isSessionId, readJson, withFileLock, writeJson } from './layout.js'

function normalizeCapability(input) {
  if (input === null || typeof input !== 'object') return null
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (name.length === 0) return null
  return {
    name,
    ...(typeof input.description === 'string' && input.description.trim().length > 0
      ? { description: input.description.trim() }
      : {}),
    ...(Array.isArray(input.tags) ? { tags: input.tags.filter(tag => typeof tag === 'string') } : {}),
    ...(Array.isArray(input.inputs) ? { inputs: input.inputs.filter(value => typeof value === 'string') } : {}),
    ...(Array.isArray(input.outputs) ? { outputs: input.outputs.filter(value => typeof value === 'string') } : {}),
  }
}

/** Durable supervisor-worker relationship registry. */
export class RelationshipStore {
  constructor(file) {
    this.file = file
    this.state = undefined
  }

  read() {
    if (this.state !== undefined) return this.state
    const raw = readJson(this.file)
    const relationships = Array.isArray(raw?.relationships)
      ? raw.relationships.filter(entry => (
        isSessionId(entry?.supervisor)
        && isSessionId(entry?.worker)
        && entry.supervisor !== entry.worker
      )).map(entry => {
        const override = normalizeCapability(entry.capabilityOverride)
        const legacy = normalizeCapability(entry.legacyCapability) ?? normalizeCapability(entry.capability)
        return {
          supervisor: entry.supervisor,
          worker: entry.worker,
          capabilityOverride: override,
          ...(legacy === null ? {} : { legacyCapability: legacy }),
          ...(typeof entry.capabilityVersion === 'string' && entry.capabilityVersion.length > 0
            ? { capabilityVersion: entry.capabilityVersion }
            : {}),
          offer: entry.offer === true,
          request: entry.request === true,
          createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
          updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
          ...(typeof entry.createdBy === 'string' ? { createdBy: entry.createdBy } : {}),
        }
      })
      : []
    this.state = { version: 1, relationships }
    return this.state
  }

  write(state) {
    this.state = state
    writeJson(this.file, { version: 1, relationships: state.relationships })
  }

  list() {
    return this.read().relationships.map(entry => ({ ...entry }))
  }

  listForSupervisor(supervisor) {
    return this.list().filter(entry => entry.supervisor === supervisor)
  }

  listForWorker(worker) {
    return this.list().filter(entry => entry.worker === worker)
  }

  get(supervisor, worker) {
    return this.read().relationships.find(entry => entry.supervisor === supervisor && entry.worker === worker)
  }

  /** Whether this session is a registered executor for at least one supervisor. */
  hasOffer(sessionId) {
    return this.read().relationships.some(entry => entry.worker === sessionId && entry.offer === true)
  }

  /** Backward-compatible worker check: only offered executors count as workers. */
  isWorker(sessionId) {
    return this.hasOffer(sessionId)
  }

  offers(supervisor, worker) {
    return this.get(supervisor, worker)?.offer === true
  }

  upsert({
    supervisor, worker, capabilityOverride = undefined, capabilityVersion = undefined,
    offer = true, request = false, createdBy,
  }, now = Date.now()) {
    if (!isSessionId(supervisor) || !isSessionId(worker) || supervisor === worker) {
      throw new Error('relationship requires two different session ids')
    }
    if (offer !== true && request !== true) throw new Error('a relationship must offer or request')
    return withFileLock(this.file, () => {
    this.state = undefined
    const state = this.read()
    const existing = state.relationships.find(entry => entry.supervisor === supervisor && entry.worker === worker)
    const override = capabilityOverride === undefined
      ? (existing?.capabilityOverride ?? null)
      : normalizeCapability(capabilityOverride)
    const nextVersion = typeof capabilityVersion === 'string' && capabilityVersion.length > 0
      ? capabilityVersion
      : (existing?.capabilityVersion ?? undefined)
    if (existing !== undefined) {
      Object.assign(existing, {
        capabilityOverride: override,
        ...(nextVersion === undefined ? { capabilityVersion: undefined } : { capabilityVersion: nextVersion }),
        offer,
        request,
        updatedAt: now,
        ...(typeof createdBy === 'string' ? { createdBy } : {}),
      })
      if (nextVersion === undefined) delete existing.capabilityVersion
      this.write(state)
      return existing
    }
    const relationship = {
      supervisor,
      worker,
      capabilityOverride: override,
      ...(nextVersion === undefined ? {} : { capabilityVersion: nextVersion }),
      offer,
      request,
      createdAt: now,
      updatedAt: now,
      ...(typeof createdBy === 'string' ? { createdBy } : {}),
    }
    state.relationships.push(relationship)
    this.write(state)
    return relationship
    })
  }

  remove(supervisor, worker) {
    return withFileLock(this.file, () => {
      this.state = undefined
      const state = this.read()
      const next = state.relationships.filter(entry => !(entry.supervisor === supervisor && entry.worker === worker))
      if (next.length === state.relationships.length) return false
      this.write({ ...state, relationships: next })
      return true
    })
  }
}
