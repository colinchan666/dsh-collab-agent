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
export interface AuthSnapshot {
  /** Fully authorized pairs. */
  readonly pairs: readonly AuthPair[]
  /** Directional grants waiting for the other side. */
  readonly pending: readonly PendingGrant[]
}

/** Host operations the collaboration plugin provides to the Remote. */
export interface CollabAdminFace {
  /** Read the current authorization state. */
  listAuth(): AuthSnapshot
  /** Authorize both directions of one pair. */
  authorize(a: string, b: string): AuthSnapshot
  /** Revoke both directions of one pair. */
  revoke(a: string, b: string): AuthSnapshot
}
