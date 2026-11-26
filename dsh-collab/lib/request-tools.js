/** Request inbox and lifecycle tools. */
import { TASK_LIST_PARAMETERS, TASK_ID_PARAMETERS, TASK_CLOSE_PARAMETERS, TASK_REJECT_PARAMETERS, REQUEST_LIST_PARAMETERS, REQUEST_ACCEPT_PARAMETERS, REQUEST_REJECT_PARAMETERS, REQUEST_HEARTBEAT_PARAMETERS, TEXT_OUTPUT } from './tool-schemas.js'
import { RequestStore } from './requests.js'
import { taskLine } from './task-views.js'
import { TaskStore } from './tasks.js'

export function createRequestTools({
  requireSelf, requireSupervisor, requests, tasks, relationships, auth, audit,
  scheduleExecutionDeadline, clearRequestTimer, sendTaskNotice, deliveryRoot, releaseDeliverySandbox,
  taskDetail, isSupervisorSession, executionTimeoutMs,
}) {
  return [
    {
      name: 'collab_requests',
      description: 'List work requests. A supervisor sees requests sent to it; any requester session sees its own requests.',
      parameters: REQUEST_LIST_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => collabSessions.has(agent.id),
      isConcurrencySafe: () => true,
      execute: (args, exec) => {
        const self = requireSelf(exec)
        const status = typeof args?.status === 'string' && args.status.trim().length > 0 ? args.status.trim() : undefined
        const list = isSupervisorSession(self.sessionId)
          ? requests.listForSupervisor(self.sessionId, status).map(RequestStore.summary)
          : requests.listForRequester(self.sessionId, status).map(RequestStore.requesterSummary)
        if (list.length === 0) return 'No requests.'
        return JSON.stringify(list)
      },
    },
    {
      name: 'collab_request_accept',
      description: 'Accept a pending work request after the requested work has been decomposed into assigned tasks.',
      parameters: REQUEST_ACCEPT_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: async (args, exec) => {
        const self = requireSupervisor(exec)
        const request = requests.get(String(args?.requestId ?? ''))
        if (request === undefined || request.supervisor !== self.sessionId) throw new Error('unknown request')
        if (request.status !== 'pending') throw new Error(`request is already ${request.status}`)
        const taskId = String(args?.taskId ?? args?.projectId ?? '')
        const task = tasks.task(taskId)
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error('unknown task for this request')
        if (task.status !== 'open') throw new Error('task is closed')
        const assigned = tasks.listForSupervisor(self.sessionId).filter(subtask => (
          subtask.taskId === taskId
          && subtask.worker !== null
          && relationships.hasOffer(subtask.worker)
          && subtask.status !== 'cancelled'
        ))
        if (assigned.length === 0) throw new Error('assign at least one subtask to an offered worker before accepting')
        if (!auth.isAuthorized(self.sessionId, request.requester)) throw new Error('未授权：请在“协同授权”页授权双方。')
        const existingBinding = task.requestId ?? null
        if (existingBinding !== null && existingBinding !== request.id) {
          throw new Error('task is already bound to another request')
        }
        const acceptedAt = Date.now()
        audit.append('request.accepted', { requestId: request.id, taskId, supervisor: self.sessionId })
        const accepted = requests.accept(request.id, {
          taskId,
          subtaskIds: assigned.map(subtask => subtask.id),
          response: typeof args?.response === 'string' ? args.response : null,
          executionDeadlineAt: acceptedAt + executionTimeoutMs,
        }, acceptedAt)
        try {
          tasks.bindTask(taskId, request.id)
        } catch (error) {
          try { requests.reopen(request.id) } catch { /* preserve the binding failure */ }
          throw error
        }
        clearRequestTimer(request.id)
        scheduleExecutionDeadline(accepted)
        const payload = {
          type: 'collab-task/request-accepted',
          version: 1,
          requestId: accepted.id,
          title: accepted.title,
          status: accepted.status,
        }
        const delivery = await sendTaskNotice(self, request.requester, payload)
        return JSON.stringify({
          request: RequestStore.summary(accepted),
          tasks: assigned.map(task => TaskStore.summary(task)),
          delivery,
        })
      },
    },
    {
      name: 'collab_request_reject',
      description: 'Reject a pending work request with the missing capability or another concrete reason.',
      parameters: REQUEST_REJECT_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: async (args, exec) => {
        const self = requireSupervisor(exec)
        const request = requests.get(String(args?.requestId ?? ''))
        if (request === undefined || request.supervisor !== self.sessionId) throw new Error('unknown request')
        if (request.status !== 'pending') throw new Error(`request is already ${request.status}`)
        if (!auth.isAuthorized(self.sessionId, request.requester)) throw new Error('未授权：请在“协同授权”页授权双方。')
        const rejected = requests.reject(request.id, String(args?.reason ?? ''))
        clearRequestTimer(request.id)
        const payload = {
          type: 'collab-task/request-rejected',
          version: 1,
          requestId: rejected.id,
          title: rejected.title,
          reason: rejected.reason,
        }
        const delivery = await sendTaskNotice(self, request.requester, payload)
        return JSON.stringify({ request: RequestStore.summary(rejected), delivery })
      },
    },
    {
      name: 'collab_request_heartbeat',
      description: 'Report progress on an accepted request and optionally extend its execution deadline.',
      parameters: REQUEST_HEARTBEAT_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: async (args, exec) => {
        const self = requireSupervisor(exec)
        const request = requests.get(String(args?.requestId ?? ''))
        if (request === undefined || request.supervisor !== self.sessionId) throw new Error('unknown request')
        if (request.status !== 'accepted') throw new Error(`request is ${request.status}, not accepted`)
        if (!auth.isAuthorized(self.sessionId, request.requester)) throw new Error('未授权：请在“协同授权”页授权双方。')
        const updated = requests.heartbeat(request.id, {
          note: typeof args?.note === 'string' ? args.note : null,
          extendByMs: Number.isFinite(Number(args?.extendByMs)) ? Number(args.extendByMs) : 0,
        })
        scheduleExecutionDeadline(updated)
        const payload = {
          type: 'collab-task/request-progress',
          version: 1,
          requestId: updated.id,
          title: updated.title,
          deadline: updated.executionDeadlineAt,
          ...(typeof args?.note === 'string' && args.note.length > 0 ? { note: args.note } : {}),
        }
        const delivery = await sendTaskNotice(self, updated.requester, payload)
        return JSON.stringify({ request: RequestStore.summary(updated), delivery })
      },
    },
    {
      name: 'collab_tasks',
      description: 'List tasks for this supervisor or, for a worker, the tasks assigned to it.',
      parameters: TASK_LIST_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id) || isManagedWorker(agent.id),
      isConcurrencySafe: () => true,
      execute: (args, exec) => {
        const self = requireSelf(exec)
        const status = typeof args?.status === 'string' && args.status.trim().length > 0 ? args.status.trim() : undefined
        const list = isSupervisorSession(self.sessionId)
          ? tasks.listForSupervisor(self.sessionId, status)
          : tasks.listForWorker(self.sessionId, status)
        if (list.length === 0) return 'No tasks.'
        return list.map(taskLine).join('\n')
      },
    },
    {
      name: 'collab_task_result',
      description: 'Read one task detail and result. Only tasks owned by this supervisor are returned.',
      parameters: TASK_ID_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      isConcurrencySafe: () => true,
      execute: (args, exec) => {
        const self = requireSupervisor(exec)
        const task = tasks.get(String(args?.taskId ?? ''))
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error('unknown task')
        return JSON.stringify(taskDetail(task))
      },
    },
    {
      name: 'collab_task_retry',
      description: 'Reset a failed/cancelled/completed task to created so it can be assigned again.',
      parameters: TASK_ID_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: (args, exec) => {
        const self = requireSupervisor(exec)
        const taskId = String(args?.taskId ?? '')
        const task = tasks.get(taskId)
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error('unknown task')
        const retried = tasks.retry(taskId)
        return `retried: ${retried.id}\nstatus: ${retried.status}`
      },
    },
    {
      name: 'collab_task_reject',
      description: 'Reject a completed task, returning it to the worker with a revision instruction.',
      parameters: TASK_REJECT_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: async (args, exec) => {
        const self = requireSupervisor(exec)
        const taskId = String(args?.taskId ?? '')
        const task = tasks.get(taskId)
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error('unknown task')
        if (task.worker === null) throw new Error('task has no worker')
        const rejected = tasks.reject(taskId, String(args?.reason ?? ''))
        const payload = {
          type: 'collab-task/assign',
          version: 1,
          taskId: rejected.taskId,
          subtaskId: rejected.id,
          supervisor: self.sessionId,
          title: rejected.title,
          instruction: rejected.instruction,
          inputs: rejected.inputs,
          acceptance: rejected.acceptance,
          deliveryDir: deliveryDirFor(rejected),
          attempt: rejected.attempts,
          revision: String(args?.reason ?? ''),
        }
        await sendTaskNotice(self, rejected.worker, payload)
        return `rejected: ${rejected.id}\nstatus: ${rejected.status}`
      },
    },
    {
      name: 'collab_task_cancel',
      description: 'Cancel a task that has not completed.',
      parameters: TASK_ID_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: (args, exec) => {
        const self = requireSupervisor(exec)
        const task = tasks.get(String(args?.taskId ?? ''))
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error('unknown task')
        const cancelled = tasks.cancel(task.id)
        return `cancelled: ${cancelled.id}`
      },
    },
    {
      name: 'collab_task_close',
      description: 'Close a task after all its subtasks are done or cancelled.',
      parameters: TASK_CLOSE_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: (args, exec) => {
        const self = requireSupervisor(exec)
        const taskId = String(args?.taskId ?? args?.projectId ?? '')
        const task = tasks.task(taskId)
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error('unknown task')
        const owned = tasks.listForSupervisor(self.sessionId).filter(subtask => subtask.taskId === taskId)
        const active = owned.filter(subtask => !['done', 'cancelled'].includes(subtask.status))
        if (active.length > 0) {
          throw new Error(`task still has ${String(active.length)} active subtask(s); complete or cancel them before closing`)
        }
        const closed = tasks.closeTask(taskId)
        audit.append('task.closed', { taskId, supervisor: self.sessionId })
        for (const task of owned) {
          if (task.worker !== null) releaseDeliverySandbox(task.worker, deliveryRoot(taskId))
        }
        return `closed: ${closed.id}\nstatus: ${closed.status}`
      },
    },
  ]
}
