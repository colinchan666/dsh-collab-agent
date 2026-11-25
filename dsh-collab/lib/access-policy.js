/** Delivery and shared-root access policy for the collaboration guard. */
import path from 'node:path'

import { canonicalPath } from './layout.js'

export function createAccessPolicy({
  sharedRoot, sessionId, selfWorkdir, layoutWorkdir, tasks, requests, isSupervisorSession, isManagedWorker,
}) {
  const comparablePath = value => {
    const resolved = path.resolve(value)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  const pathInside = (candidate, root) => {
    const resolvedCandidate = comparablePath(candidate)
    const resolvedRoot = comparablePath(root)
    return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  }
  const canonicalSharedRoot = canonicalPath(sharedRoot)
  const taskIdFromShared = (resolved) => {
    if (!pathInside(resolved, canonicalSharedRoot)) return undefined
    const relative = path.relative(canonicalSharedRoot, resolved).split(path.sep).filter(Boolean)
    if (relative.length < 2 || relative[1] !== 'artifacts') return undefined
    return relative[0]
  }
  const deliveryAccessFor = (candidate, write) => {
    if (typeof candidate !== 'string' || candidate.length === 0) return false
    const resolved = canonicalPath(path.resolve(selfWorkdir, candidate))
    const taskId = taskIdFromShared(resolved)
    if (taskId === undefined) return false
    const task = tasks.task(taskId)
    if (task === undefined) return false
    if (isSupervisorSession(sessionId)) return task.supervisor === sessionId && write !== true
    if (isManagedWorker(sessionId)) {
      if (write && task.status !== 'open') return false
      return tasks.listForWorker(sessionId).some(subtask => (
        subtask.taskId === taskId && subtask.supervisor === task.supervisor
      ))
    }
    if (write) return false
    return requests.listForRequester(sessionId).some(request => (
      request.taskId === taskId
      && (request.status === 'delivered' || (request.status === 'accepted' && request.delivery !== null))
      && task.requestId === request.id
      && request.delivery !== null
    ))
  }
  const sharedAccessDenied = (candidates, write) => {
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || candidate.length === 0) continue
      const lexical = path.resolve(selfWorkdir, candidate)
      const resolved = canonicalPath(lexical)
      if (!pathInside(lexical, sharedRoot) && !pathInside(resolved, canonicalSharedRoot)) continue
      if (pathInside(lexical, sharedRoot) && !pathInside(resolved, canonicalSharedRoot)) return { path: lexical }
      if (deliveryAccessFor(candidate, write)) continue
      return { path: lexical }
    }
    return undefined
  }
  const managedWriteAllowed = (candidate) => {
    if (!isManagedWorker(sessionId)) return true
    if (typeof candidate !== 'string' || candidate.length === 0) return false
    const resolved = canonicalPath(path.resolve(selfWorkdir, candidate))
    if (deliveryAccessFor(candidate, true)) return true
    for (const own of [path.join(layoutWorkdir ?? selfWorkdir, 'private'), path.join(layoutWorkdir ?? selfWorkdir, 'comm')]) {
      if (pathInside(resolved, canonicalPath(own))) return true
    }
    return false
  }
  const allowedDeliveryPaths = (candidates, write) => candidates.filter(candidate => !deliveryAccessFor(candidate, write))
  return { deliveryAccessFor, sharedAccessDenied, managedWriteAllowed, allowedDeliveryPaths }
}
