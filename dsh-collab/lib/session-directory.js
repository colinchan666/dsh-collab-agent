/** Canonical session metadata projection for collaboration UIs. */
export function createSessionDirectory({
  registry,
  sessions,
  sessionTitle,
  sessionQuery,
  archivedSessionIds,
  agentPresets,
  agents,
}) {
  const metadata = new Map()
  let hydrateInFlight = null

  const cached = sessionId => metadata.get(sessionId)
  const titleFor = (sessionId, stored, originalCwd) => {
    const entry = cached(sessionId)
    if (entry !== undefined && entry.title !== undefined) return entry.title
    if (typeof stored === 'string' && stored.length > 0) return stored
    const live = sessions?.get?.(sessionId)
    if (live === undefined) return null
    return sessionTitle?.get?.(live)?.title ?? null
  }
  const presetFor = (sessionId, stored) => {
    const entry = cached(sessionId)
    if (entry !== undefined && entry.presetLoaded === true) return entry.preset ?? null
    if (entry !== undefined && entry.preset !== undefined && entry.preset !== null) return entry.preset
    return stored ?? null
  }

  const view = entry => ({
    sessionId: entry.sessionId,
    title: titleFor(entry.sessionId, entry.title),
    preset: presetFor(entry.sessionId, entry.preset),
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
    updateTitle: (sessionId, title, seq) => {
      if (typeof title !== 'string' || title.length === 0) return
      const current = cached(sessionId) ?? {}
      if (typeof seq === 'number' && typeof current.titleSeq === 'number' && seq < current.titleSeq) return
      metadata.set(sessionId, { ...current, title, titleSeq: typeof seq === 'number' ? seq : current.titleSeq })
    },
    updatePreset: (sessionId, preset) => {
      if (typeof preset !== 'string' || preset.length === 0) return
      metadata.set(sessionId, { ...(cached(sessionId) ?? {}), preset })
    },
    async hydrate() {
      if (hydrateInFlight !== null) return hydrateInFlight
      hydrateInFlight = (async () => {
        const pending = registry.list().filter(entry => cached(entry.sessionId)?.presetLoaded !== true)
        for (let index = 0; index < pending.length; index += 8) {
          await Promise.all(pending.slice(index, index + 8).map(async entry => {
            const previous = cached(entry.sessionId) ?? {}
            try {
              const title = await sessionQuery?.readTitle?.(entry.sessionId)
              if (title?.title !== undefined) {
                previous.title = title.title
                if (typeof title.eventSeq === 'number') previous.titleSeq = title.eventSeq
              } else if (previous.title === undefined) {
                previous.title = null
              }
            } catch { /* best effort */ }
            if (typeof sessionQuery?.inspectSession === 'function') {
              try {
                const preset = await sessionQuery.inspectSession(
                  entry.sessionId,
                  session => agentPresets?.presetForSession?.(session) ?? session?.header?.agentPreset,
                )
                if (preset !== undefined) {
                  previous.preset = preset
                  previous.presetLoaded = true
                }
              } catch { /* best effort */ }
            }
            metadata.set(entry.sessionId, previous)
          }))
        }
      })().finally(() => { hydrateInFlight = null })
      return hydrateInFlight
    },
  }
}
