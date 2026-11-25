/**
 * Supervisor task registry. A task is the unit created for one accepted
 * request; subtasks are the units assigned to functional workers. The store is
 * the source of truth for assignment, completion, results, and task lifecycle;
 * collaboration messages are only wake-up notifications.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'

import { fileStamp, isSessionId, readStateJson, withFileLock, writeJson } from './layout.js'

const ACTIVE_STATUSES = new Set(['created', 'assigned', 'accepted', 'running'])

function nowIso(now) {
  return new Date(now).toISOString()
}

function subtaskSummary(subtask) {
  return {
    id: subtask.id,
    subtaskId: subtask.id,
    taskId: subtask.taskId,
    supervisor: subtask.supervisor,
    worker: subtask.worker,
    title: subtask.title,
    status: subtask.status,
    attempts: subtask.attempts,
    createdAt: subtask.createdAt,
    updatedAt: subtask.updatedAt,
    ...(Number.isInteger(subtask.createdTurn) ? { createdTurn: subtask.createdTurn } : {}),
    ...(Number.isInteger(subtask.assignedTurn) ? { assignedTurn: subtask.assignedTurn } : {}),
    ...(typeof subtask.capabilityVersion === 'string' ? { capabilityVersion: subtask.capabilityVersion } : {}),
    ...(subtask.result === null ? {} : { result: subtask.result }),
    ...(subtask.failure === null ? {} : { failure: subtask.failure }),
  }
}

function taskSummary(task) {
  return {
    id: task.id,
    taskId: task.id,
    supervisor: task.supervisor,
    title: task.title,
    status: task.status,
    requestId: task.requestId ?? null,
    createdAt: task.createdAt,
    closedAt: task.closedAt ?? null,
  }
}

/** Convert the old project/task document into tasks/subtasks. */
function migrateLegacy(raw) {
  if (raw === null || typeof raw !== 'object') return { version: 2, tasks: {}, subtasks: {} }
  if (raw.version === 2 && raw.subtasks !== null && typeof raw.subtasks === 'object') {
    return {
      version: 2,
      tasks: raw.tasks !== null && typeof raw.tasks === 'object' ? raw.tasks : {},
      subtasks: raw.subtasks,
    }
  }
  const tasks = {}
  for (const [id, project] of Object.entries(raw.projects ?? {})) {
    if (project === null || typeof project !== 'object') continue
    tasks[id] = {
      id,
      supervisor: project.supervisor,
      title: project.title,
      status: project.status === 'closed' ? 'closed' : 'open',
      requestId: project.requestId ?? null,
      createdAt: project.createdAt ?? Date.now(),
      closedAt: project.closedAt ?? null,
    }
  }
  const subtasks = {}
  for (const [id, task] of Object.entries(raw.tasks ?? {})) {
    if (task === null || typeof task !== 'object') continue
    const taskId = task.projectId ?? task.taskId
    if (typeof taskId !== 'string') continue
    subtasks[id] = {
      ...task,
      id,
      taskId,
      subtaskId: id,
    }
    delete subtasks[id].projectId
  }
  return { version: 2, tasks, subtasks }
}

/** Durable tasks and their subtasks. */
export class TaskStore {
  constructor(file) {
    this.file = file
    this.state = undefined
  }

  read() {
    const stamp = fileStamp(this.file)
    if (this.state !== undefined && this.stamp === stamp) return this.state
    const raw = readStateJson(this.file)
    this.state = migrateLegacy(raw)
    this.stamp = stamp
    return this.state
  }

  write(state) {
    this.state = { version: 2, tasks: state.tasks, subtasks: state.subtasks }
    writeJson(this.file, this.state)
    this.stamp = fileStamp(this.file)
  }

  /** Persist a legacy document as the current schema once. */
  migrate() {
    if (fs.existsSync(this.file) && readStateJson(this.file)?.version === 2) return false
    return withFileLock(this.file, () => {
      this.state = undefined
      const state = this.read()
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.v1.bak`)
      this.write(state)
      return true
    })
  }

  // Parent task API.
  task(taskId) {
    return this.read().tasks[taskId]
  }

  getTask(taskId) {
    return this.task(taskId)
  }

  listTasks(supervisor) {
    return Object.values(this.read().tasks)
      .filter(task => task.supervisor === supervisor)
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  createTask({ supervisor, title, requestId = null }, now = Date.now()) {
    if (!isSessionId(supervisor)) throw new Error('task requires a supervisor session')
    return withFileLock(this.file, () => {
      const id = `task-${crypto.randomUUID()}`
      const task = {
        id,
        taskId: id,
        supervisor,
        title: String(title ?? 'Untitled task'),
        status: 'open',
        requestId: requestId ?? null,
        createdAt: now,
        closedAt: null,
      }
      this.state = undefined
      const state = this.read()
      state.tasks[id] = task
      this.write(state)
      return task
    })
  }

  bindTask(taskId, requestId) {
    return this.updateTask(taskId, (task) => {
      if (task.requestId !== null && task.requestId !== requestId) {
        throw new Error(`task is already bound to another request: ${String(task.requestId)}`)
      }
      task.requestId = requestId
    })
  }

  updateTask(taskId, mutate, now = Date.now()) {
    return withFileLock(this.file, () => {
      this.state = undefined
      const state = this.read()
      const task = state.tasks[taskId]
      if (task === undefined) throw new Error(`unknown task: ${String(taskId)}`)
      mutate(task, now)
      task.updatedAt = now
      this.write(state)
      return task
    })
  }

  closeTask(taskId, now = Date.now()) {
    return this.updateTask(taskId, (task) => {
      if (task.status === 'closed') return
      task.status = 'closed'
      task.closedAt = now
    }, now)
  }

  // Subtask API. The old method names remain aliases for the Host tools.
  get(subtaskId) {
    return this.read().subtasks[subtaskId]
  }

  getSubtask(subtaskId) {
    return this.get(subtaskId)
  }

  listForSupervisor(supervisor, status) {
    return Object.values(this.read().subtasks)
      .filter(task => task.supervisor === supervisor && (status === undefined || task.status === status))
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  listSubtasksForTask(taskId, status) {
    return Object.values(this.read().subtasks)
      .filter(task => task.taskId === taskId && (status === undefined || task.status === status))
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  listForWorker(worker, status) {
    return Object.values(this.read().subtasks)
      .filter(task => task.worker === worker && (status === undefined || task.status === status))
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  activeCount(worker) {
    return Object.values(this.read().subtasks)
      .filter(task => task.worker === worker && ACTIVE_STATUSES.has(task.status)).length
  }

  activeTaskCount(taskId) {
    return Object.values(this.read().subtasks)
      .filter(task => task.taskId === taskId && ACTIVE_STATUSES.has(task.status)).length
  }

  createSubtask({
    supervisor, worker, taskId, title, instruction, inputs = {}, acceptance = '', createdTurn = null,
  }, now = Date.now()) {
    if (!isSessionId(supervisor)) throw new Error('subtask requires a supervisor session')
    if (worker !== null && worker !== undefined && !isSessionId(worker)) throw new Error('subtask requires a valid worker session')
    if (typeof taskId !== 'string' || taskId.length === 0) throw new Error('subtask requires a task')
    const id = `subtask-${crypto.randomUUID()}`
    const subtask = {
      id,
      subtaskId: id,
      taskId,
      supervisor,
      worker: worker ?? null,
      title: String(title ?? '').trim() || 'Untitled subtask',
      instruction: String(instruction ?? ''),
      inputs: inputs !== null && typeof inputs === 'object' ? inputs : {},
      acceptance: String(acceptance ?? ''),
      status: 'created',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      createdTurn: Number.isInteger(createdTurn) ? createdTurn : null,
      assignedTurn: null,
      capabilityVersion: null,
      result: null,
      failure: null,
      history: [],
    }
    return withFileLock(this.file, () => {
      this.state = undefined
      const state = this.read()
      if (state.tasks[taskId] === undefined) throw new Error(`unknown task: ${taskId}`)
      state.subtasks[id] = subtask
      this.write(state)
      return subtask
    })
  }

  update(subtaskId, mutate, now = Date.now()) {
    return withFileLock(this.file, () => {
      this.state = undefined
      const state = this.read()
      const subtask = state.subtasks[subtaskId]
      if (subtask === undefined) throw new Error(`unknown subtask: ${String(subtaskId)}`)
      mutate(subtask, now)
      subtask.updatedAt = now
      this.write(state)
      return subtask
    })
  }

  assign(subtaskId, worker, assignedTurn, capabilityVersion, now = Date.now()) {
    return this.update(subtaskId, (subtask) => {
      if (subtask.worker !== null && subtask.worker !== worker) throw new Error('subtask is assigned to a different worker')
      if (!['created', 'assigned', 'failed'].includes(subtask.status)) throw new Error(`subtask cannot be assigned from ${subtask.status}`)
      subtask.worker = worker
      subtask.status = 'assigned'
      subtask.attempts += 1
      subtask.failure = null
      if (Number.isInteger(assignedTurn)) subtask.assignedTurn = assignedTurn
      subtask.capabilityVersion = typeof capabilityVersion === 'string' ? capabilityVersion : subtask.capabilityVersion
      subtask.history.push({ at: nowIso(now), status: 'assigned', note: `attempt ${String(subtask.attempts)}` })
    }, now)
  }

  accept(subtaskId, worker, now = Date.now()) {
    return this.update(subtaskId, (subtask) => {
      if (subtask.worker !== worker) throw new Error('subtask is assigned to a different worker')
      if (!['assigned', 'accepted', 'running'].includes(subtask.status)) throw new Error(`subtask cannot be accepted from ${subtask.status}`)
      if (subtask.status === 'assigned') subtask.status = 'accepted'
      subtask.history.push({ at: nowIso(now), status: subtask.status, note: 'accepted' })
    }, now)
  }

  progress(subtaskId, worker, note, now = Date.now()) {
    return this.update(subtaskId, (subtask) => {
      if (subtask.worker !== worker) throw new Error('subtask is assigned to a different worker')
      if (!ACTIVE_STATUSES.has(subtask.status)) throw new Error(`subtask is not active: ${subtask.status}`)
      subtask.status = subtask.status === 'assigned' || subtask.status === 'accepted' ? 'running' : subtask.status
      subtask.history.push({ at: nowIso(now), status: subtask.status, note: String(note ?? '') })
    }, now)
  }

  complete(subtaskId, worker, result, now = Date.now()) {
    return this.update(subtaskId, (subtask) => {
      if (subtask.worker !== worker) throw new Error('subtask is assigned to a different worker')
      if (!ACTIVE_STATUSES.has(subtask.status)) throw new Error(`subtask cannot be completed from ${subtask.status}`)
      subtask.status = 'done'
      subtask.result = {
        summary: String(result?.summary ?? ''),
        details: String(result?.details ?? ''),
        artifacts: Array.isArray(result?.artifacts)
          ? result.artifacts.filter(value => typeof value === 'string')
          : [],
        completedAt: nowIso(now),
      }
      subtask.history.push({ at: nowIso(now), status: 'done', note: 'completed by worker' })
    }, now)
  }

  fail(subtaskId, worker, reason, now = Date.now()) {
    return this.update(subtaskId, (subtask) => {
      if (subtask.worker !== worker) throw new Error('subtask is assigned to a different worker')
      if (!ACTIVE_STATUSES.has(subtask.status)) throw new Error(`subtask cannot fail from ${subtask.status}`)
      subtask.status = 'failed'
      subtask.failure = String(reason ?? '')
      subtask.history.push({ at: nowIso(now), status: 'failed', note: subtask.failure })
    }, now)
  }

  retry(subtaskId, now = Date.now()) {
    return this.update(subtaskId, (subtask) => {
      if (!['failed', 'cancelled', 'done'].includes(subtask.status)) throw new Error(`subtask cannot be retried from ${subtask.status}`)
      subtask.status = 'created'
      subtask.result = null
      subtask.failure = null
      subtask.history.push({ at: nowIso(now), status: 'created', note: 'retry requested by supervisor' })
    }, now)
  }

  reject(subtaskId, reason, now = Date.now()) {
    return this.update(subtaskId, (subtask) => {
      if (subtask.status !== 'done') throw new Error('only a completed subtask can be rejected')
      subtask.status = 'assigned'
      subtask.failure = String(reason ?? '')
      subtask.result = null
      subtask.history.push({ at: nowIso(now), status: 'assigned', note: `rejected: ${subtask.failure}` })
    }, now)
  }

  cancel(subtaskId, now = Date.now()) {
    return this.update(subtaskId, (subtask) => {
      if (!['created', 'assigned', 'accepted', 'running', 'failed'].includes(subtask.status)) throw new Error(`subtask cannot be cancelled from ${subtask.status}`)
      subtask.status = 'cancelled'
      subtask.history.push({ at: nowIso(now), status: 'cancelled', note: 'cancelled by supervisor' })
    }, now)
  }

  // Compatibility aliases used by the existing Host composition.
}

TaskStore.summary = subtaskSummary
TaskStore.taskSummary = taskSummary
