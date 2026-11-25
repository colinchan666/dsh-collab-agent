/** Pure read-only collaboration health projection used by collab_doctor. */
export function collectHealth({
  sessionId, registryEntries, relationships, grants, tasks, requests, auditEntries, isSupervisor,
}) {
  const presetOf = id => registryEntries.find(entry => entry.sessionId === id)?.preset
  const invalidRelationships = relationships.filter(relationship => (
    presetOf(relationship.worker) !== 'collab'
    || presetOf(relationship.supervisor) !== 'supervisor'
  ))
  const invalidGrants = grants.filter(grant => (
    (presetOf(grant.from) !== undefined && presetOf(grant.from) !== 'collab' && presetOf(grant.from) !== 'supervisor')
    || (presetOf(grant.to) !== undefined && presetOf(grant.to) !== 'collab' && presetOf(grant.to) !== 'supervisor')
  ))
  const tasksForSelf = isSupervisor ? tasks : []
  const requestsForSelf = requests.filter(request => request.supervisor === sessionId || request.requester === sessionId)
  return {
    sessionId,
    registry: registryEntries.length,
    relationships: relationships.length,
    invalidRelationships: invalidRelationships.length,
    grants: grants.length,
    invalidGrants: invalidGrants.length,
    tasks: tasksForSelf.length,
    activeTasks: tasksForSelf.filter(task => task.status === 'open').length,
    requests: requestsForSelf.length,
    activeRequests: requestsForSelf.filter(request => request.status === 'accepted').length,
    auditEntries,
  }
}
