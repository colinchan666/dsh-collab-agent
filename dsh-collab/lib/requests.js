/**
 * Worker-to-supervisor work requests. A request asks a supervisor to evaluate
 * available worker capabilities and, when feasible, decompose the work into
 * assigned tasks. The supervisor agent owns that evaluation; this store owns
 * only the durable request lifecycle and result.
 */
import crypto from 'node:crypto'

import { isSessionId, readJson, writeJson } from './layout.js'

const REQUEST_STATUSES = new Set(['pending', 'accepted', 'rejected', 'cancelled'])

function normalizeText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function requestSummary(request) {
  return {
    id: request.id,
    requester: request.requester,
    supervisor: request.supervisor,
    title: request.title,
    requirement: request.requirement,
    status: request.status,
    ...(request.reason === null ? {} : { reason: request.reason }),
    ...(request.projectId === null ? {} : { projectId: request.projectId }),
    ...(request.taskIds.length === 0 ? {} : { taskIds: [...request.taskIds] }),
    ...(request.response === null ? {} : { response: request.response }),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    ...(request.resolvedAt === null ? {} : { resolvedAt: request.resolvedAt }),
    ...(request.delivery === null ? {} : { delivery: request.delivery }),
  }
}

/** Requester-facing view: status only, with no internal project/task scheduling. */
function requesterSummary(request) {
  return {
    id: request.id,
    requester: request.requester,
    supervisor: request.supervisor,
    title: request.title,
    requirement: request.requirement,
    status: request.status,
    ...(request.reason === null ? {} : { reason: request.reason }),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    ...(request.resolvedAt === null ? {} : { resolvedAt: request.resolvedAt }),
    ...(request.delivery === null ? {} : { delivery: request.delivery }),
  }
}

/** Durable worker requests, keyed by request id. */
export class RequestStore {
  constructor(file) {
    this.file = file
    this.state = undefined
  }

  read() {
    if (this.state !== undefined) return this.state
    const raw = readJson(this.file)
    const source = raw?.requests !== null && typeof raw?.requests === 'object' ? raw.requests : {}
    const requests = {}
    for (const [id, entry] of Object.entries(source)) {
      if (entry === null || typeof entry !== 'object') continue
      const requester = typeof entry.requester === 'string' ? entry.requester : entry.worker
      if (!isSessionId(requester) || !isSessionId(entry.supervisor)) continue
      const normalized = { ...entry, requester }
      delete normalized.worker
      if (normalized.delivery === undefined) normalized.delivery = null
      requests[id] = normalized
    }
    this.state = { version: 1, requests }
    return this.state
  }

  write(state) {
    this.state = state
    writeJson(this.file, { version: 1, requests: state.requests })
  }

  get(id) {
    return this.read().requests[id]
  }

  listForRequester(requester, status) {
    return Object.values(this.read().requests)
      .filter(request => request.requester === requester && (status === undefined || request.status === status))
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  listForSupervisor(supervisor, status) {
    return Object.values(this.read().requests)
      .filter(request => request.supervisor === supervisor && (status === undefined || request.status === status))
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  create({ requester, supervisor, title, requirement, createdTurn = null }, now = Date.now()) {
    if (!isSessionId(requester) || !isSessionId(supervisor) || requester === supervisor) {
      throw new Error('request requires two different session ids')
    }
    const normalizedTitle = normalizeText(title)
    if (normalizedTitle.length === 0) throw new Error('request title must not be empty')
    const normalizedRequirement = normalizeText(requirement)
    if (normalizedRequirement.length === 0) throw new Error('request requirement must not be empty')
    const id = `request-${crypto.randomUUID()}`
    const request = {
      id,
      requester,
      supervisor,
      title: normalizedTitle,
      requirement: normalizedRequirement,
      status: 'pending',
      reason: null,
      projectId: null,
      taskIds: [],
      response: null,
      createdTurn: Number.isInteger(createdTurn) ? createdTurn : null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      delivery: null,
    }
    const state = this.read()
    state.requests[id] = request
    this.write(state)
    return request
  }

  update(id, mutate, now = Date.now()) {
    const state = this.read()
    const request = state.requests[id]
    if (request === undefined) throw new Error(`unknown request: ${String(id)}`)
    mutate(request, now)
    request.updatedAt = now
    this.write(state)
    return request
  }

  accept(id, { projectId, taskIds = [], response = null }, now = Date.now()) {
    const normalizedProjectId = normalizeText(projectId)
    if (normalizedProjectId.length === 0) throw new Error('accept requires a project id')
    return this.update(id, (request) => {
      if (request.status !== 'pending') throw new Error(`request is already ${request.status}`)
      request.status = 'accepted'
      request.projectId = normalizedProjectId
      request.taskIds = Array.isArray(taskIds) ? taskIds.filter(value => typeof value === 'string') : []
      request.response = response === null ? null : String(response)
      request.reason = null
      request.resolvedAt = now
    }, now)
  }

  reject(id, reason, now = Date.now()) {
    const normalizedReason = normalizeText(reason)
    if (normalizedReason.length === 0) throw new Error('reject requires a reason')
    return this.update(id, (request) => {
      if (request.status !== 'pending') throw new Error(`request is already ${request.status}`)
      request.status = 'rejected'
      request.reason = normalizedReason
      request.resolvedAt = now
    }, now)
  }

  markDelivered(id, delivery, now = Date.now()) {
    return this.update(id, (request) => {
      request.delivery = delivery
      request.updatedAt = now
    }, now)
  }

  cancel(id, requester, now = Date.now()) {
    return this.update(id, (request) => {
      if (request.requester !== requester) throw new Error('request belongs to another session')
      if (request.status !== 'pending') throw new Error(`request is already ${request.status}`)
      request.status = 'cancelled'
      request.resolvedAt = now
    }, now)
  }

  static statuses = REQUEST_STATUSES
  static summary = requestSummary
  static requesterSummary = requesterSummary
}
