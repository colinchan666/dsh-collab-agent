/**
 * Supervisor task/project registry. The store is the source of truth for
 * assignment, completion, results, and project lifecycle; collaboration
 * messages are only wake-up notifications.
 */
import crypto from 'node:crypto'

import { isSessionId, readJson, withFileLock, writeJson } from './layout.js'

const ACTIVE_STATUSES = new Set(['created', 'assigned', 'accepted', 'running'])
const TASK_STATUSES = new Set(['created', 'assigned', 'accepted', 'running', 'done', 'failed', 'cancelled'])

function nowIso(now) {
  return new Date(now).toISOString()
}

function taskSummary(task) {
  return {
    id: task.id,
    projectId: task.projectId,
    supervisor: task.supervisor,
    worker: task.worker,
    title: task.title,
    status: task.status,
    attempts: task.attempts,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(Number.isInteger(task.createdTurn) ? { createdTurn: task.createdTurn } : {}),
    ...(Number.isInteger(task.assignedTurn) ? { assignedTurn: task.assignedTurn } : {}),
    ...(typeof task.capabilityVersion === 'string' ? { capabilityVersion: task.capabilityVersion } : {}),
    ...(task.result === null ? {} : { result: task.result }),
    ...(task.failure === null ? {} : { failure: task.failure }),
  }
}

/** Durable tasks and their projects. */
export class TaskStore {
  constructor(file) {
    this.file = file
    this.state = undefined
  }

  read() {
    if (this.state !== undefined) return this.state
    const raw = readJson(this.file)
    const projects = raw?.projects !== null && typeof raw?.projects === 'object' ? raw.projects : {}
    for (const project of Object.values(projects)) {
      if (project !== null && typeof project === 'object' && project.requestId === undefined) project.requestId = null
    }
    const tasks = raw?.tasks !== null && typeof raw?.tasks === 'object' ? raw.tasks : {}
    this.state = { version: 1, projects, tasks }
    return this.state
  }

  write(state) {
    this.state = state
    writeJson(this.file, { version: 1, projects: state.projects, tasks: state.tasks })
  }

  get(taskId) {
    return this.read().tasks[taskId]
  }

  project(projectId) {
    return this.read().projects[projectId]
  }

  listProjects(supervisor) {
    return Object.values(this.read().projects)
      .filter(project => project.supervisor === supervisor)
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  listForSupervisor(supervisor, status) {
    return Object.values(this.read().tasks)
      .filter(task => task.supervisor === supervisor && (status === undefined || task.status === status))
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  listForWorker(worker) {
    return Object.values(this.read().tasks)
      .filter(task => task.worker === worker)
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  activeCount(worker) {
    return Object.values(this.read().tasks).filter(task => task.worker === worker && ACTIVE_STATUSES.has(task.status)).length
  }

  activeProjectCount(projectId) {
    return Object.values(this.read().tasks).filter(task => task.projectId === projectId && ACTIVE_STATUSES.has(task.status)).length
  }

  createProject({ supervisor, title }, now = Date.now()) {
    if (!isSessionId(supervisor)) throw new Error('project requires a supervisor session')
    return withFileLock(this.file, () => {
      const id = `project-${crypto.randomUUID()}`
      const project = {
        id,
        supervisor,
        title: String(title ?? 'Supervisor project'),
        status: 'open',
        requestId: null,
        createdAt: now,
        closedAt: null,
      }
      this.state = undefined
      const state = this.read()
      state.projects[id] = project
      this.write(state)
      return project
    })
  }

  createTask({
    supervisor, worker, projectId, title, instruction, inputs = {}, acceptance = '', createdTurn = null,
  }, now = Date.now()) {
    if (!isSessionId(supervisor)) throw new Error('task requires a supervisor session')
    if (worker !== null && worker !== undefined && !isSessionId(worker)) throw new Error('task requires a valid worker session')
    const id = `task-${crypto.randomUUID()}`
    const task = {
      id,
      supervisor,
      worker: worker ?? null,
      projectId: projectId ?? null,
      title: String(title ?? '').trim() || 'Untitled task',
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
      if (projectId !== null && projectId !== undefined) {
        if (state.projects[projectId] === undefined) throw new Error(`unknown project: ${String(projectId)}`)
      }
      state.tasks[id] = task
      this.write(state)
      return task
    })
  }

  update(taskId, mutate, now = Date.now()) {
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

  assign(taskId, worker, now = Date.now(), assignedTurn = null, capabilityVersion = null) {
    return this.update(taskId, (task) => {
      if (!isSessionId(worker)) throw new Error('task assignment requires a worker session')
      if (task.worker !== null && task.worker !== worker) throw new Error('task is assigned to a different worker')
      if (!['created', 'assigned', 'failed'].includes(task.status)) throw new Error(`task cannot be assigned from ${task.status}`)
      task.worker = worker
      task.status = 'assigned'
      task.attempts += 1
      task.failure = null
      if (Number.isInteger(assignedTurn)) task.assignedTurn = assignedTurn
      task.capabilityVersion = typeof capabilityVersion === 'string' ? capabilityVersion : task.capabilityVersion
      task.history.push({ at: nowIso(now), status: 'assigned', note: `attempt ${String(task.attempts)}` })
    }, now)
  }

  accept(taskId, worker, now = Date.now()) {
    return this.update(taskId, (task) => {
      if (task.worker !== worker) throw new Error('task is assigned to a different worker')
      if (!['assigned', 'accepted', 'running'].includes(task.status)) throw new Error(`task cannot be accepted from ${task.status}`)
      if (task.status === 'assigned') task.status = 'accepted'
      task.history.push({ at: nowIso(now), status: task.status, note: 'accepted' })
    }, now)
  }

  progress(taskId, worker, note, now = Date.now()) {
    return this.update(taskId, (task) => {
      if (task.worker !== worker) throw new Error('task is assigned to a different worker')
      if (!ACTIVE_STATUSES.has(task.status)) throw new Error(`task is not active: ${task.status}`)
      task.status = task.status === 'assigned' || task.status === 'accepted' ? 'running' : task.status
      task.history.push({ at: nowIso(now), status: task.status, note: String(note ?? '') })
    }, now)
  }

  complete(taskId, worker, result, now = Date.now()) {
    return this.update(taskId, (task) => {
      if (task.worker !== worker) throw new Error('task is assigned to a different worker')
      if (!ACTIVE_STATUSES.has(task.status)) throw new Error(`task cannot be completed from ${task.status}`)
      task.status = 'done'
      task.result = {
        summary: String(result?.summary ?? ''),
        details: String(result?.details ?? ''),
        artifacts: Array.isArray(result?.artifacts)
          ? result.artifacts.filter(value => typeof value === 'string')
          : [],
        completedAt: nowIso(now),
      }
      task.history.push({ at: nowIso(now), status: 'done', note: 'completed by worker' })
    }, now)
  }

  fail(taskId, worker, reason, now = Date.now()) {
    return this.update(taskId, (task) => {
      if (task.worker !== worker) throw new Error('task is assigned to a different worker')
      if (!ACTIVE_STATUSES.has(task.status)) throw new Error(`task cannot fail from ${task.status}`)
      task.status = 'failed'
      task.failure = String(reason ?? '')
      task.history.push({ at: nowIso(now), status: 'failed', note: task.failure })
    }, now)
  }

  retry(taskId, now = Date.now()) {
    return this.update(taskId, (task) => {
      if (!['failed', 'cancelled', 'done'].includes(task.status)) throw new Error(`task cannot be retried from ${task.status}`)
      task.status = 'created'
      task.result = null
      task.failure = null
      task.history.push({ at: nowIso(now), status: 'created', note: 'retry requested by supervisor' })
    }, now)
  }

  reject(taskId, reason, now = Date.now()) {
    return this.update(taskId, (task) => {
      if (task.status !== 'done') throw new Error('only a completed task can be rejected')
      task.status = 'assigned'
      task.failure = String(reason ?? '')
      task.result = null
      task.history.push({ at: nowIso(now), status: 'assigned', note: `rejected: ${task.failure}` })
    }, now)
  }

  cancel(taskId, now = Date.now()) {
    return this.update(taskId, (task) => {
      if (task.status === 'done') throw new Error('a completed task cannot be cancelled')
      task.status = 'cancelled'
      task.history.push({ at: nowIso(now), status: 'cancelled', note: 'cancelled by supervisor' })
    }, now)
  }

  bindProject(projectId, requestId, now = Date.now()) {
    if (!isSessionId(requestId)) throw new Error('project binding requires a request id')
    return withFileLock(this.file, () => {
      this.state = undefined
      const state = this.read()
      const project = state.projects[projectId]
      if (project === undefined) throw new Error(`unknown project: ${String(projectId)}`)
      if (project.requestId !== null && project.requestId !== requestId) {
        throw new Error('project is already bound to another request')
      }
      if (project.requestId === requestId) return project
      project.requestId = requestId
      project.updatedAt = now
      this.write(state)
      return project
    })
  }

  closeProject(projectId, now = Date.now()) {
    return withFileLock(this.file, () => {
      this.state = undefined
      const state = this.read()
      const project = state.projects[projectId]
      if (project === undefined) throw new Error(`unknown project: ${String(projectId)}`)
      if (project.status === 'closed') return project
      const active = Object.values(state.tasks).some(task => (
        task.projectId === projectId && ACTIVE_STATUSES.has(task.status)
      ))
      if (active) throw new Error('project still has active tasks')
      project.status = 'closed'
      project.closedAt = now
      this.write(state)
      return project
    })
  }

  summaryForSupervisor(supervisor) {
    const tasks = this.listForSupervisor(supervisor)
    return tasks.map(taskSummary)
  }

  /** Public task summary used by tool results. */
  static summary(task) {
    return taskSummary(task)
  }
}

export { ACTIVE_STATUSES, TASK_STATUSES }
