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

/** One recoverable state-file backup. */
export interface StateBackup {
  /** Backup basename in the same directory as the state file. */
  readonly name: string
  /** Backup size in bytes, when it could be read. */
  readonly bytes?: number
  /** Backup parses as a JSON object and may be restored. */
  readonly valid: boolean
}

/** Health of one collaboration state document. */
export interface StateFileStatus {
  /** Stable recovery key: registry, authorization, relationships, tasks, requests, or notices. */
  readonly key: string
  /** Absolute file path. */
  readonly path: string
  /** Current file exists. */
  readonly exists: boolean
  /** Current file size in bytes, when it exists. */
  readonly bytes?: number
  /** Current file parses as a JSON object. */
  readonly valid: boolean
  /** Current file exists but is malformed. */
  readonly corrupt: boolean
  /** Backups found next to the file. */
  readonly backups: readonly StateBackup[]
}

/** Recovery inventory returned after every status or mutation. */
export interface RecoveryStatus {
  /** All known collaboration state documents. */
  readonly files: readonly StateFileStatus[]
  /** Time this inventory was generated. */
  readonly generatedAt: number
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
  /** List state files, malformed documents, and their backups. */
  recoveryStatus(): RecoveryStatus
  /** Move a malformed/missing state document aside and invalidate its cache. */
  recoveryReset(key: string): RecoveryStatus
  /** Restore one valid backup over the current state document. */
  recoveryRestore(key: string, backup: string): RecoveryStatus
}
