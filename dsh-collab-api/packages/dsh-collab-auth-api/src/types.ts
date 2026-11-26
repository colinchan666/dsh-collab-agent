/** Shared authorization DTOs for the generated Remote boundary. */

/** One fully authorized communication pair. */
export interface AuthPair {
  /** First Session id in the pair. */
  readonly a: string
  /** Second Session id in the pair. */
  readonly b: string
  /** Creation time in epoch milliseconds. */
  readonly createdAt: number
  /** Last update time in epoch milliseconds. */
  readonly updatedAt: number
}

/** One directional grant that still lacks its reverse side. */
export interface PendingGrant {
  /** Granting Session id. */
  readonly from: string
  /** Receiving Session id. */
  readonly to: string
  /** Creation time in epoch milliseconds. */
  readonly createdAt: number
  /** Last update time in epoch milliseconds. */
  readonly updatedAt: number
}

/** Complete authorization state the page renders. */
export interface SessionDirectoryEntry {
  readonly sessionId: string
  readonly title: string | null
  readonly preset: string
  readonly archived: boolean
  readonly online: boolean
  readonly workspace: string | null
}

export interface AuthSnapshot {
  /** Fully authorized pairs. */
  readonly pairs: readonly AuthPair[]
  /** Directional grants waiting for the other side. */
  readonly pending: readonly PendingGrant[]
  /** Canonical collaboration session directory. */
  readonly sessions: readonly SessionDirectoryEntry[]
}

/** Host operations the collaboration plugin provides to the Remote. */
export interface CollabAdminFace {
  /** Read the current authorization state. */
  listAuth(): AuthSnapshot
  /** Authorize both directions of one pair. */
  authorize(a: string, b: string): AuthSnapshot
  /** Revoke both directions of one pair. */
  revoke(a: string, b: string): AuthSnapshot
  /** Read or mutate a collaboration management surface without a command record. */
  panel(sessionId: string, operation: string, args?: Record<string, unknown>): Record<string, unknown>
  /** Read the supervisor board. */
  board(sessionId: string): Record<string, unknown>
  /** Link an offered worker. */
  link(sessionId: string, worker: string, payload?: Record<string, unknown>): Record<string, unknown>
  /** Unlink a worker. */
  unlink(sessionId: string, worker: string): Record<string, unknown>
  /** Pin a worker capability. */
  pin(sessionId: string, worker: string): Record<string, unknown>
  /** Return a worker to live capability. */
  live(sessionId: string, worker: string): Record<string, unknown>
  /** Read a session base prompt. */
  baseGet(sessionId: string): Record<string, unknown>
  /** Set a session base prompt. */
  baseSet(sessionId: string, value: string): Record<string, unknown>
}
