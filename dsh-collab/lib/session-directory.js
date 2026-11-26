/** Canonical session metadata projection for collaboration UIs. */
export function createSessionDirectory({ registry, sessions, sessionTitle, agents }) {
  const titleFor = (sessionId, stored) => {
    if (typeof stored === 'string' && stored.length > 0) return stored
    const live = sessions?.get?.(sessionId)
    if (live === undefined) return null
    return sessionTitle?.get?.(live)?.title ?? null
  }
  const view = entry => ({
    sessionId: entry.sessionId,
    title: titleFor(entry.sessionId, entry.title),
    preset: entry.preset,
    archived: entry.archived === true,
    online: agents?.get?.(entry.sessionId) !== undefined,
    workspace: entry.originalCwd ?? null,
  })
  return {
    get: sessionId => {
      const entry = registry.get(sessionId)
      return entry === undefined ? undefined : view(entry)
    },
    getMany: sessionIds => new Map(sessionIds
      .map(sessionId => [sessionId, registry.get(sessionId)])
      .filter(([, entry]) => entry !== undefined)
      .map(([sessionId, entry]) => [sessionId, view(entry)])),
    list: () => registry.list().map(view),
  }
}
