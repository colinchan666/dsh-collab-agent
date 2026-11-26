/** Delivery list, manifest, and publication tools. */
import path from 'node:path'
import crypto from 'node:crypto'
import { DELIVERY_LIST_PARAMETERS, DELIVERY_MANIFEST_PARAMETERS, REQUEST_DELIVER_PARAMETERS, TEXT_OUTPUT } from './tool-schemas.js'

export function createDeliveryTools({
  requireSupervisor, tasks, requests, auth, sharedRoot, listDeliveryFiles,
  MAX_DELIVERY_LIST_FILES, iso, buildDeliveryManifest, deliveryInFlight,
  publishDeliveryAlias, sendTaskNotice, audit, clearExecutionTimer, isSupervisorSession,
}) {
  return [
    {
      name: 'collab_delivery_list',
      description: 'List canonical delivery files for this supervisor\'s tasks. Names, sizes, and times only; content is not read.',
      parameters: DELIVERY_LIST_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      isConcurrencySafe: () => true,
      execute: (args, exec) => {
        const self = requireSupervisor(exec)
        const taskId = typeof args?.taskId === 'string' && args.taskId.trim().length > 0
          ? args.taskId.trim()
          : (typeof args?.projectId === 'string' && args.projectId.trim().length > 0 ? args.projectId.trim() : undefined)
        if (taskId !== undefined) {
          const task = tasks.task(taskId)
          if (task === undefined || task.supervisor !== self.sessionId) throw new Error('unknown task')
          const files = listDeliveryFiles(path.join(sharedRoot, taskId, 'artifacts'))
          if (files.length === 0) return 'No delivery files.'
          const lines = files.map(file => `${file.path}  ${String(file.size)}B  ${iso(file.modifiedAt)}`)
          if (files.truncated === true) lines.push(`(truncated at ${MAX_DELIVERY_LIST_FILES} files)`)
          return lines.join('\n')
        }
        const lines = []
        for (const task of tasks.listTasks(self.sessionId)) {
          const files = listDeliveryFiles(path.join(sharedRoot, task.id, 'artifacts'))
          for (const file of files) {
            lines.push(`${task.id}/${file.path}  ${String(file.size)}B  ${iso(file.modifiedAt)}`)
          }
          if (files.truncated === true) lines.push(`${task.id}/(truncated at ${MAX_DELIVERY_LIST_FILES} files)`)
        }
        return lines.length === 0 ? 'No delivery files.' : lines.join('\n')
      },
    },
    {
      name: 'collab_delivery_manifest',
      description: 'Build and persist a canonical delivery manifest (path, bytes, sha256, mode) for a supervisor task.',
      parameters: DELIVERY_MANIFEST_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: (args, exec) => {
        const self = requireSupervisor(exec)
        const taskId = String(args?.taskId ?? args?.projectId ?? '')
        const task = tasks.task(taskId)
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error('unknown task')
        return JSON.stringify(buildDeliveryManifest(taskId))
      },
    },
    {
      name: 'collab_request_deliver',
      description: 'Send the sanitized delivery manifest for an accepted request to its requester. Does not expose task assignments, worker ids, or internal scheduling.',
      parameters: REQUEST_DELIVER_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: async (args, exec) => {
        const self = requireSupervisor(exec)
        const request = requests.get(String(args?.requestId ?? ''))
        if (request === undefined || request.supervisor !== self.sessionId) throw new Error('unknown request')
        if (request.status !== 'accepted' && request.status !== 'delivered') {
          throw new Error(`request is ${request.status}, not delivery-ready`)
        }
        if (request.taskId === null) throw new Error('accepted request has no task')
        const task = tasks.task(request.taskId)
        if (task === undefined) throw new Error('request task no longer exists')
        if (task.requestId !== request.id) throw new Error('task is not bound to this request')
        if (task.status !== 'closed') throw new Error('close the task before delivery')
        const activeTasks = tasks.listForSupervisor(self.sessionId)
          .filter(subtask => subtask.taskId === task.id && !['done', 'cancelled'].includes(subtask.status))
        if (activeTasks.length > 0) throw new Error('all subtasks must be done or cancelled before delivery')
        if (deliveryInFlight.has(request.id)) throw new Error('delivery is already in progress')
        if (!auth.isAuthorized(self.sessionId, request.requester)) throw new Error('未授权：请在“协同授权”页授权双方。')
        deliveryInFlight.add(request.id)
        try {
          const manifest = buildDeliveryManifest(request.taskId)
          if (manifest.files.length === 0) throw new Error('delivery has no artifacts')
        const manifestSha256 = crypto.createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex')
        const deliveryId = `delivery-${manifestSha256.slice(0, 16)}`
        if (request.delivery !== null && request.delivery.manifestSha256 === manifestSha256) {
          return JSON.stringify({
            requestId: request.id,
            alreadyDelivered: true,
            deliveryId: request.delivery.deliveryId,
            files: manifest.files.length,
          })
        }
        const supersedes = request.delivery === null ? null : request.delivery.deliveryId
        const publicRoot = publishDeliveryAlias(request.taskId, deliveryId)
        const payload = {
          type: 'collab-task/request-delivered',
          version: 1,
          requestId: request.id,
          title: request.title,
          deliveryId,
          manifestSha256,
          ...(supersedes === null ? {} : { supersedes }),
          root: publicRoot,
          files: manifest.files,
        }
          const delivery = await sendTaskNotice(self, request.requester, payload)
          const recorded = requests.markDelivered(request.id, {
            deliveryId,
            manifestSha256,
            deliveredAt: Date.now(),
            ...(supersedes === null ? {} : { supersedes }),
          })
          audit.append('delivery.published', { requestId: request.id, taskId: request.taskId, deliveryId })
          clearExecutionTimer(request.id)
          return JSON.stringify({ requestId: request.id, status: recorded.status, files: manifest.files.length, deliveryId, delivery })
        } finally {
          deliveryInFlight.delete(request.id)
        }
      },
    },
  ]
}
