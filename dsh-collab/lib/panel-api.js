/** Typed facade over the JSON panel transport used by the Host Remote. */
export function createPanelApi(panel) {
  return {
    board: sessionId => panel(sessionId, 'board', {}),
    link: (sessionId, worker, payload) => panel(sessionId, 'link', { worker, payload }),
    unlink: (sessionId, worker) => panel(sessionId, 'unlink', { worker }),
    pin: (sessionId, worker) => panel(sessionId, 'pin', { worker }),
    live: (sessionId, worker) => panel(sessionId, 'live', { worker }),
    baseGet: sessionId => panel(sessionId, 'baseGet', {}),
    baseSet: (sessionId, value) => panel(sessionId, 'baseSet', { value }),
  }
}
