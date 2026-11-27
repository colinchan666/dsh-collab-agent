/** Canonical session metadata projection for collaboration UIs. */
export function createSessionDirectory({
  registry,
  sessions,
  sessionTitle,
  sessionQuery,
  archivedSessionIds,
  agents,
}) {
  const persistedTitles = new Map()

  const titleFor = (sessionId, stored) => {
    if (typeof stored === 'string' && stored.length > 0) return stored
    const persisted = persistedTitles.get(sessionId)
    if (typeof persisted === 'string' && persisted.length > 0) return persisted
    const live = sessions?.get?.(sessionId)
    if (live === undefined) return null
    return sessionTitle?.get?.(live)?.title ?? null
  }

  const view = entry => ({
    sessionId: entry.sessionId,
    title: titleFor(entry.sessionId, entry.title),
    preset: entry.preset,
    archived: entry.archived === true || archivedSessionIds?.()?.has(entry.sessionId) === true,
    online: agents?.get?.(entry.sessionId) !== undefined,
    workspace: entry.originalCwd ?? null,
  })

  return {
    get: sessionId => {
      const entry = registry.get(sessionId)
      return entry === undefined ? undefined : view(entry)
    },
    getMany: sessionIds => new Map(
      sessionIds
        .map(sessionId => [sessionId, registry.get(sessionId)])
        .filter(([, entry]) => entry !== undefined)
        .map(([sessionId, entry]) => [sessionId, view(entry)]),
    ),
    list: () => registry.list().map(view),
    async hydrate() {
      if (sessionQuery?.readTitle === undefined) return
      await Promise.all(registry.list().map(async entry => {
        if (typeof entry.title === 'string' && entry.title.length > 0) return
        if (persistedTitles.has(entry.sessionId)) return
        try {
          const title = await sessionQuery.readTitle(entry.sessionId)
          if (typeof title?.title === 'string' && title.title.length > 0) {
            persistedTitles.set(entry.sessionId, title.title)
          }
        } catch {
          /* best effort */
        }
      }))
    },
  }
}
