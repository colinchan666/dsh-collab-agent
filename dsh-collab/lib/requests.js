/**
 * Worker-to-supervisor work requests. A request asks a supervisor to evaluate
 * available worker capabilities and, when feasible, decompose the work into
 * assigned tasks. The supervisor agent owns that evaluation; this store owns
 * only the durable request lifecycle and result.
 */
import crypto from 'node:crypto'

import { fileStamp, isSessionId, readStateJson, withFileLock, writeJson } from './layout.js'

const REQUEST_STATUSES = new Set(['pending', 'accepted', 'delivered', 'rejected', 'cancelled', 'expired'])

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
    ...(request.expiresAt === null ? {} : { expiresAt: request.expiresAt }),
    ...(request.executionDeadlineAt === null ? {} : { executionDeadlineAt: request.executionDeadlineAt }),
    ...(request.overdue === true ? { overdue: true, overdueAt: request.overdueAt } : {}),
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
    ...(request.expiresAt === null ? {} : { expiresAt: request.expiresAt }),
    ...(request.executionDeadlineAt === null ? {} : { executionDeadlineAt: request.executionDeadlineAt }),
    ...(request.overdue === true ? { overdue: true, overdueAt: request.overdueAt } : {}),
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
    const stamp = fileStamp(this.file)
    if (this.state !== undefined && this.stamp === stamp) return this.state
    const raw = readStateJson(this.file)
    const source = raw?.requests !== null && typeof raw?.requests === 'object' ? raw.requests : {}
    const requests = {}
    for (const [id, entry] of Object.entries(source)) {
      if (entry === null || typeof entry !== 'object') continue
      const requester = typeof entry.requester === 'string' ? entry.requester : entry.worker
      if (!isSessionId(requester) || !isSessionId(entry.supervisor)) continue
      const normalized = { ...entry, requester }
      delete normalized.worker
      if (normalized.delivery === undefined) normalized.delivery = null
      if (normalized.expiresAt === undefined) normalized.expiresAt = null
      if (normalized.executionDeadlineAt === undefined) normalized.executionDeadlineAt = null
      if (normalized.overdue === undefined) normalized.overdue = false
      if (normalized.overdueAt === undefined) normalized.overdueAt = null
      if (!Array.isArray(normalized.taskIds)) normalized.taskIds = []
      if (normalized.response === undefined) normalized.response = null
      if (normalized.reason === undefined) normalized.reason = null
      if (normalized.projectId === undefined) normalized.projectId = null
      requests[id] = normalized
    }
    this.state = { version: 1, requests }
    this.stamp = stamp
    return this.state
  }

  write(state) {
    this.state = state
    writeJson(this.file, { version: 1, requests: state.requests })
    this.stamp = fileStamp(this.file)
  }

  get(id) {
    return this.read().requests[id]
  }

  list() {
    return Object.values(this.read().requests)
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

  create({ requester, supervisor, title, requirement, createdTurn = null, expiresAt = null }, now = Date.now()) {
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
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
      executionDeadlineAt: null,
      overdue: false,
      overdueAt: null,
    }
    return withFileLock(this.file, () => {
      this.state = undefined
      const state = this.read()
      state.requests[id] = request
      this.write(state)
      return request
    })
  }

  update(id, mutate, now = Date.now()) {
    return withFileLock(this.file, () => {
      this.state = undefined
      const state = this.read()
      const request = state.requests[id]
      if (request === undefined) throw new Error(`unknown request: ${String(id)}`)
      mutate(request, now)
      request.updatedAt = now
      this.write(state)
      return request
    })
  }

  accept(id, { projectId, taskIds = [], response = null, executionDeadlineAt = null }, now = Date.now()) {
    const normalizedProjectId = normalizeText(projectId)
    if (normalizedProjectId.length === 0) throw new Error('accept requires a project id')
    return this.update(id, (request) => {
      if (request.status !== 'pending') throw new Error(`request is already ${request.status}`)
      if (Number.isFinite(request.expiresAt) && request.expiresAt <= now) throw new Error('request has expired')
      request.status = 'accepted'
      request.projectId = normalizedProjectId
      request.taskIds = Array.isArray(taskIds) ? taskIds.filter(value => typeof value === 'string') : []
      request.response = response === null ? null : String(response)
      request.reason = null
      request.resolvedAt = now
      request.executionDeadlineAt = Number.isFinite(executionDeadlineAt) ? executionDeadlineAt : null
      request.overdue = false
      request.overdueAt = null
    }, now)
  }

  /** Revert an acceptance that could not be bound/notified; the timer is left to the caller. */
  reopen(id, now = Date.now()) {
    return this.update(id, (request) => {
      if (request.status !== 'accepted') throw new Error(`request is ${request.status}`)
      request.status = 'pending'
      request.projectId = null
      request.taskIds = []
      request.response = null
      request.reason = null
      request.resolvedAt = null
      request.delivery = null
      request.executionDeadlineAt = null
      request.overdue = false
      request.overdueAt = null
    }, now)
  }

  reject(id, reason, now = Date.now()) {
    const normalizedReason = normalizeText(reason)
    if (normalizedReason.length === 0) throw new Error('reject requires a reason')
    return this.update(id, (request) => {
      if (request.status !== 'pending') throw new Error(`request is already ${request.status}`)
      if (Number.isFinite(request.expiresAt) && request.expiresAt <= now) throw new Error('request has expired')
      request.status = 'rejected'
      request.reason = normalizedReason
      request.resolvedAt = now
    }, now)
  }

  expire(id, now = Date.now()) {
    return this.update(id, (request) => {
      if (request.status !== 'pending') throw new Error(`request is already ${request.status}`)
      request.status = 'expired'
      request.reason = 'supervisor did not respond before the deadline'
      request.resolvedAt = now
    }, now)
  }

  markDelivered(id, delivery, now = Date.now()) {
    return this.update(id, (request) => {
      if (request.status !== 'accepted' && request.status !== 'delivered') {
        throw new Error(`request is ${request.status}, not delivery-ready`)
      }
      request.status = 'delivered'
      request.delivery = delivery
      request.executionDeadlineAt = null
      request.updatedAt = now
    }, now)
  }

  markOverdue(id, now = Date.now()) {
    return this.update(id, (request) => {
      if (request.status !== 'accepted' || request.overdue === true) return
      request.overdue = true
      request.overdueAt = now
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
