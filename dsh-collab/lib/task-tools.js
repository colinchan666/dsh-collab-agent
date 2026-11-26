/** Supervisor task, subtask, and requester submission tools. */
import { TASK_OPEN_PARAMETERS, TASK_CREATE_PARAMETERS, TASK_ASSIGN_PARAMETERS, TASK_ID_PARAMETERS, TASK_LIST_PARAMETERS, TASK_REJECT_PARAMETERS, TASK_PROGRESS_PARAMETERS, TASK_COMPLETE_PARAMETERS, TASK_FAIL_PARAMETERS, TASK_CLOSE_PARAMETERS, REQUEST_SUBMIT_PARAMETERS, REQUEST_CANCEL_PARAMETERS, TEXT_OUTPUT, NO_PARAMETERS } from './tool-schemas.js'
import { TaskStore } from './tasks.js'
import { RequestStore } from './requests.js'
import { taskDetail, taskLine } from './task-views.js'
import { SUPERVISOR_PRESET as SUPERVISOR } from './presets.js'

export function createTaskTools({
  ctx, tasks, relationships, auth, registry, requests, audit, deliveryRoot, deliveryDirFor,
  sendTaskNotice, releaseDeliverySandbox, bindDeliverySandbox, isFunctionalWorker,
  effectiveCapability, isSupervisorSession, isManagedWorker, requireSupervisor, requireWorker,
  requireSelf, turnForCall, collabSessions, sessionDirectory, sharedRoot, mkdirp, cancelBoundTask, clearExecutionTimer,
  clearRequestTimer, scheduleRequestTimeout, requestTimeoutMs, subtaskAliases,
}) {
  const taskTools = [
    {
      name: 'collab_capabilities',
      description: 'List functional sessions registered to this supervisor, their capabilities, authorization, online state, and active task count.',
      parameters: NO_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      isConcurrencySafe: () => true,
      execute: (_args, exec) => {
        const self = requireSupervisor(exec)
        const relationshipsForSelf = relationships.listForSupervisor(self.sessionId)
          .filter(relationship => relationship.offer === true && isFunctionalWorker(relationship.worker))
        if (relationshipsForSelf.length === 0) return 'No functional sessions are registered to this supervisor yet.'
        const lines = [`supervisor: ${self.sessionId}`, '']
        for (const relationship of relationshipsForSelf) {
          if (relationship.offer !== true) continue
          const worker = sessionDirectory.get(relationship.worker)
          const online = worker?.online === true
          const authorized = auth.isAuthorized(self.sessionId, relationship.worker)
          const active = tasks.activeCount(relationship.worker)
          const capability = effectiveCapability(relationship)
          const name = capability?.name ?? '(request-only)'
          const description = capability?.description ?? ''
          const source = capability?.source ?? 'none'
          const version = capability?.version ?? '-'
          const changed = capability?.changed === true ? 'yes' : 'no'
          lines.push(
            `- ${relationship.worker}  capability=${JSON.stringify(name)}  source=${source}  version=${version}  changed=${changed}  offer=${relationship.offer ? 'yes' : 'no'}  authorized=${authorized ? 'yes' : 'no'}  ${online ? 'online' : 'offline'}  active=${String(active)}${description.length === 0 ? '' : `  description=${JSON.stringify(description)}`}${worker?.title === undefined ? '' : `  title=${JSON.stringify(worker.title)}`}`,
          )
        }
        return lines.join('\n')
      },
    },
    {
      name: 'collab_task_open',
      description: 'Open the parent task for one requirement. Create subtasks under the returned taskId.',
      parameters: TASK_OPEN_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: (args, exec) => {
        const self = requireSupervisor(exec)
        const title = String(args?.title ?? '').trim()
        if (title.length === 0) throw new Error('task title must not be empty')
        const task = tasks.createTask({ supervisor: self.sessionId, title })
        audit.append('task.opened', { taskId: task.id, supervisor: self.sessionId, title })
        return JSON.stringify({ task: TaskStore.taskSummary(task) })
      },
    },
    {
      name: 'collab_task_create',
      description: 'Create a subtask under an existing parent task opened with collab_task_open.',
      parameters: TASK_CREATE_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: (args, exec) => {
        const self = requireSupervisor(exec)
        const title = String(args?.title ?? '').trim()
        const instruction = String(args?.instruction ?? '')
        if (title.length === 0) throw new Error('task title must not be empty')
        if (instruction.trim().length === 0) throw new Error('task instruction must not be empty')
        const mentionsSharedCopy = (instruction.includes(sharedRoot) || instruction.includes('/shared/'))
          && /(?:cp|copy|rsync|ln|mv|复制|拷贝|共享目录)/iu.test(instruction)
        if (mentionsSharedCopy) {
          throw new Error('do not create copy-out tasks; workers receive a canonical deliveryDir and publish artifacts there')
        }
        const taskId = String(args?.taskId ?? '').trim()
        if (taskId.length === 0) throw new Error('taskId is required; call collab_task_open first')
        const task = tasks.task(taskId)
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error(`unknown task: ${taskId}`)
        if (task.status !== 'open') throw new Error('task is closed')
        const subtask = tasks.createSubtask({
          supervisor: self.sessionId,
          worker: null,
          taskId,
          title,
          instruction,
          inputs: args?.inputs,
          acceptance: args?.acceptance,
          createdTurn: turnForCall(exec),
        })
        return JSON.stringify({ subtask: taskDetail(subtask), taskId })
      },
    },
    {
      name: 'collab_task_assign',
      description: 'Assign a task to a worker with an offer relationship. The worker is woken with the assignment.',
      parameters: TASK_ASSIGN_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: async (args, exec) => {
        const self = requireSupervisor(exec)
        const subtaskId = String(args?.subtaskId ?? args?.taskId ?? '')
        const worker = String(args?.worker ?? '')
        const task = tasks.get(subtaskId)
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error(`unknown subtask: ${subtaskId}`)
        const relationship = relationships.get(self.sessionId, worker)
        if (relationship === undefined || relationship.offer !== true) {
          throw new Error('worker is not registered to this supervisor with an offer capability')
        }
        if (!isFunctionalWorker(worker)) throw new Error('worker must be a collaboration session')
        if (!auth.isAuthorized(self.sessionId, worker)) {
          throw new Error('未授权：请在“协同授权”页授权双方。')
        }
        const project = task.taskId === null ? undefined : tasks.task(task.taskId)
        if (project !== undefined && project.status !== 'open') throw new Error('project is closed')
        const otherActive = tasks.listForWorker(worker)
          .filter(entry => entry.id !== subtaskId && !['done', 'failed', 'cancelled'].includes(entry.status))
          .length
        if (otherActive >= 1) throw new Error('worker already has an active task; capacity is 1')
        const deliveryDir = deliveryRoot(task.taskId)
        mkdirp(deliveryDir, 0o755)
        bindDeliverySandbox(worker, deliveryDir)
        const assigned = tasks.assign(subtaskId, worker, turnForCall(exec), effectiveCapability(relationship)?.version ?? null)
        audit.append('task.assigned', { taskId: assigned.id, supervisor: self.sessionId, worker })
        const payload = {
          type: 'collab-task/assign',
          version: 1,
          taskId: assigned.taskId,
          subtaskId: assigned.id,
          supervisor: self.sessionId,
          title: assigned.title,
          instruction: assigned.instruction,
          inputs: assigned.inputs,
          acceptance: assigned.acceptance,
          deliveryDir,
          attempt: assigned.attempts,
        }
        const delivery = await sendTaskNotice(self, worker, payload)
        return [
          `assigned: ${assigned.id}`,
          `worker: ${worker}`,
          `status: ${assigned.status}`,
          `delivery: ${delivery}`,
          `deliveryDir: ${deliveryDir}`,
        ].join('\n')
      },
    },
    {
      name: 'collab_task_accept',
      description: 'Accept an assigned task and return its instructions, acceptance criteria, and delivery directory.',
      parameters: TASK_ID_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isManagedWorker(agent.id),
      execute: (args, exec) => {
        const self = requireWorker(exec)
        const task = tasks.get(String(args?.taskId ?? ''))
        if (task === undefined || task.worker !== self.sessionId) throw new Error('unknown task for this worker')
        const accepted = tasks.accept(task.id, self.sessionId)
        const deliveryDir = deliveryDirFor(accepted)
        bindDeliverySandbox(self.sessionId, deliveryDir)
        return JSON.stringify({ ...taskDetail(accepted), deliveryDir })
      },
    },
    {
      name: 'collab_task_progress',
      description: 'Record progress on an accepted task.',
      parameters: TASK_PROGRESS_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isManagedWorker(agent.id),
      execute: (args, exec) => {
        const self = requireWorker(exec)
        const task = tasks.get(String(args?.taskId ?? ''))
        if (task === undefined || task.worker !== self.sessionId) throw new Error('unknown task for this worker')
        const progressed = tasks.progress(task.id, self.sessionId, String(args?.note ?? ''))
        return `progress: ${progressed.id}\nstatus: ${progressed.status}`
      },
    },
    {
      name: 'collab_task_complete',
      description: 'Complete a task and notify its supervisor with the result summary.',
      parameters: TASK_COMPLETE_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isManagedWorker(agent.id),
      execute: async (args, exec) => {
        const self = requireWorker(exec)
        const task = tasks.get(String(args?.taskId ?? ''))
        if (task === undefined || task.worker !== self.sessionId) throw new Error('unknown task for this worker')
        const completed = tasks.complete(task.id, self.sessionId, {
          summary: args?.summary,
          details: args?.details,
          artifacts: args?.artifacts,
        })
        audit.append('task.completed', { taskId: completed.id, worker: self.sessionId })
        const delivery = await sendTaskNotice(self, completed.supervisor, {
          type: 'collab-task/result',
          version: 1,
          taskId: completed.id,
          status: 'done',
        })
        return [
          `completed: ${completed.id}`,
          `status: ${completed.status}`,
          `delivery: ${delivery}`,
        ].join('\n')
      },
    },
    {
      name: 'collab_task_fail',
      description: 'Report a task failure to its supervisor.',
      parameters: TASK_FAIL_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isManagedWorker(agent.id),
      execute: async (args, exec) => {
        const self = requireWorker(exec)
        const task = tasks.get(String(args?.taskId ?? ''))
        if (task === undefined || task.worker !== self.sessionId) throw new Error('unknown task for this worker')
        const failed = tasks.fail(task.id, self.sessionId, String(args?.reason ?? ''))
        const delivery = await sendTaskNotice(self, failed.supervisor, {
          type: 'collab-task/result',
          version: 1,
          taskId: failed.id,
          status: 'failed',
        })
        return [
          `failed: ${failed.id}`,
          `status: ${failed.status}`,
          `delivery: ${delivery}`,
        ].join('\n')
      },
    },
    {
      name: 'collab_request_submit',
      description: 'Ask an authorized supervisor to evaluate and decompose work. No offer/worker relationship is required; bilateral authorization is enough.',
      parameters: REQUEST_SUBMIT_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => collabSessions.has(agent.id) && !isSupervisorSession(agent.id),
      execute: async (args, exec) => {
        const self = requireSelf(exec)
        const eligible = registry.list()
          .filter(entry => entry.preset === SUPERVISOR && auth.isAuthorized(self.sessionId, entry.sessionId))
        if (eligible.length === 0) {
          throw new Error('no authorized supervisor; authorize a supervisor pair in the authorization page first')
        }
        const targetId = typeof args?.supervisor === 'string' && args.supervisor.trim().length > 0
          ? args.supervisor.trim()
          : undefined
        let supervisor
        if (targetId !== undefined) {
          supervisor = eligible.find(candidate => candidate.sessionId === targetId)
          if (supervisor === undefined) throw new Error('target supervisor is not authorized for this session')
        } else if (eligible.length === 1) {
          supervisor = eligible[0]
        } else {
          throw new Error(`specify a supervisor: ${eligible.map(candidate => candidate.sessionId).join(', ')}`)
        }
        const now = Date.now()
        const request = requests.create({
          requester: self.sessionId,
          supervisor: supervisor.sessionId,
          title: String(args?.title ?? ''),
          requirement: String(args?.requirement ?? ''),
          createdTurn: turnForCall(exec),
          expiresAt: now + requestTimeoutMs,
        }, now)
        try {
          const delivery = await sendTaskNotice(self, supervisor.sessionId, {
            type: 'collab-task/request',
            version: 1,
            requestId: request.id,
            requester: self.sessionId,
            title: request.title,
            requirement: request.requirement,
          })
          scheduleRequestTimeout(request)
          return JSON.stringify({ request: RequestStore.requesterSummary(request), delivery })
        } catch (error) {
          try { requests.cancel(request.id, self.sessionId) } catch { /* preserve the original failure */ }
          throw error
        }
      },
    },
    {
      name: 'collab_request_cancel',
      description: 'Cancel one of your pending work requests.',
      parameters: REQUEST_CANCEL_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => collabSessions.has(agent.id) && !isSupervisorSession(agent.id),
      execute: async (args, exec) => {
        const self = requireSelf(exec)
        const request = requests.get(String(args?.requestId ?? ''))
        if (request === undefined || request.requester !== self.sessionId) throw new Error('unknown request')
        const cancelled = requests.cancel(request.id, self.sessionId)
        clearRequestTimer(request.id)
        clearExecutionTimer(request.id)
        if (request.taskId !== null) {
          cancelBoundTask(tasks, request.taskId, worker => releaseDeliverySandbox(worker, deliveryRoot(request.taskId)))
        }
        try {
          await sendTaskNotice(self, request.supervisor, {
            type: 'collab-task/request-cancelled',
            version: 1,
            requestId: cancelled.id,
            title: cancelled.title,
          })
        } catch { /* cancellation remains effective even if the notice cannot be delivered */ }
        return JSON.stringify({ request: RequestStore.requesterSummary(cancelled) })
      },
    },
  ]

  taskTools.push({
    name: 'collab_task_list',
    description: 'List parent tasks for this supervisor.',
    parameters: TASK_LIST_PARAMETERS,
    output: TEXT_OUTPUT,
    when: ({ agent }) => isSupervisorSession(agent.id),
    isConcurrencySafe: () => true,
    execute: (args, exec) => {
      const self = requireSupervisor(exec)
      const status = typeof args?.status === 'string' && args.status.trim().length > 0 ? args.status.trim() : undefined
      const list = tasks.listTasks(self.sessionId)
        .filter(task => status === undefined || task.status === status)
        .map(task => TaskStore.taskSummary(task))
      return list.length === 0 ? 'No tasks.' : JSON.stringify(list)
    },
  })

  return taskTools
}
