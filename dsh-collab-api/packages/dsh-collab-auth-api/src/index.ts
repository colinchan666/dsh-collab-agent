/**
 * Host authorization Remote: the human-facing pair list and the two
 * user-only mutations. Transport is generated Typert Remote, so the UI never
 * needs a control Session or a slash command.
 */

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'

import type { AuthSnapshot, CollabAdminFace } from './types.js'

export type * from './types.js'

/** Diagnostic marker for the first Host mount. */
/** Session ids minted by DSH. */
const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

/** Reject ids that could not name a Session before touching the stores. */
function sessionId(value: string, parameter: string): string {
  if (!SESSION_ID.test(value)) throw new Error(`Invalid ${parameter}: ${value}`)
  return value
}

function sessionIdOf(value: string, parameter: string): string {
  return sessionId(value, parameter)
}

/** Host service backing the generated `ctx.remote.collabAuth` namespace. */
export class CollabAuthService extends TypertRemoteService {
  /** Required Host services: the collaborator admin face and Typert registration. */
  static inject = ['typert']

  /**
   * Bind the service to the generated namespace.
   * @param ctx - owning Host Context.
   */
  constructor(ctx: Context) {
    super(ctx, 'collabAuth', { namespace: 'collabAuth' })
  }

  /**
   * Preserve the management surface's owner-only policy. The generated
   * resource readers still describe the sessions each call touches; a future
   * non-owner grant cannot bypass this check accidentally.
   */
  private assertOwner(): void {
    const invocation = (this.ctx as unknown as {
      invocation?: { peer?: { principal?: { kind?: string } } }
    }).invocation
    const principal = invocation?.peer?.principal
    if (principal !== undefined && principal.kind !== 'owner') {
      throw new Error('collaboration management is owner-only')
    }
  }

  /**
   * Resolve the collaborator admin face at call time so a later Host reload
   * can replace it without re-mounting this Remote service.
   * @returns the live admin face.
   */
  private admin(): CollabAdminFace {
    const admin = this.ctx.get('collabAdmin')
    if (admin === undefined) throw new Error('collabAdmin is not available')
    return admin
  }

  /**
   * Read entirely authorized pairs and one-sided pending grants.
   * @returns the current authorization snapshot.
   */
  @Remote('list')
  list(): AuthSnapshot {
    this.assertOwner()
    return this.admin().listAuth()
  }

  /**
   * Authorize both directions of a pair.
   * @param a - first Session id.
   * @param b - second Session id.
   * @returns the resulting authorization snapshot.
   */
  // @ts-expect-error Typert reads the options object at build time.
  @Remote({ name: 'authorize', resources: { session: (a: string, b: string) => [a, b] } })
  authorize(a: string, b: string): AuthSnapshot {
    this.assertOwner()
    return this.admin().authorize(sessionId(a, 'a'), sessionId(b, 'b'))
  }

  /**
   * Revoke both directions of a pair.
   * @param a - first Session id.
   * @param b - second Session id.
   * @returns the resulting authorization snapshot.
   */
  // @ts-expect-error Typert reads the options object at build time.
  @Remote({ name: 'revoke', resources: { session: (a: string, b: string) => [a, b] } })
  revoke(a: string, b: string): AuthSnapshot {
    this.assertOwner()
    return this.admin().revoke(sessionId(a, 'a'), sessionId(b, 'b'))
  }

  /**
   * Read or mutate the supervisor board/base-prompt surface without writing a
   * slash-command lifecycle into the conversation.
   * @param sessionId - collaboration Session id.
   * @param operation - board, baseGet, baseSet, link, unlink, pin, or live.
   * @param args - operation-specific payload.
   * @returns the operation result.
   */
  // @ts-expect-error Typert reads the options object at build time.
  @Remote({ name: 'board', resources: { session: (sessionId: string) => sessionId } })
  board(sessionId: string): string {
    this.assertOwner()
    return JSON.stringify(this.admin().board(sessionIdOf(sessionId, 'sessionId')))
  }

  // @ts-expect-error Typert reads the options object at build time.
  @Remote({ name: 'link', resources: { session: (sessionId: string) => sessionId } })
  link(sessionId: string, worker: string, payloadJson: string): string {
    this.assertOwner()
    const id = sessionIdOf(sessionId, 'sessionId')
    const peer = sessionIdOf(worker, 'worker')
    let payload: Record<string, unknown> = {}
    if (payloadJson.trim().length > 0) {
      const parsed: unknown = JSON.parse(payloadJson)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('link payload must be a JSON object')
      payload = parsed as Record<string, unknown>
    }
    return JSON.stringify(this.admin().link(id, peer, payload))
  }

  // @ts-expect-error Typert reads the options object at build time.
  @Remote({ name: 'unlink', resources: { session: (sessionId: string) => sessionId } })
  unlink(sessionId: string, worker: string): string {
    this.assertOwner()
    return JSON.stringify(this.admin().unlink(sessionIdOf(sessionId, 'sessionId'), sessionIdOf(worker, 'worker')))
  }

  // @ts-expect-error Typert reads the options object at build time.
  @Remote({ name: 'pin', resources: { session: (sessionId: string) => sessionId } })
  pin(sessionId: string, worker: string): string {
    this.assertOwner()
    return JSON.stringify(this.admin().pin(sessionIdOf(sessionId, 'sessionId'), sessionIdOf(worker, 'worker')))
  }

  // @ts-expect-error Typert reads the options object at build time.
  @Remote({ name: 'live', resources: { session: (sessionId: string) => sessionId } })
  live(sessionId: string, worker: string): string {
    this.assertOwner()
    return JSON.stringify(this.admin().live(sessionIdOf(sessionId, 'sessionId'), sessionIdOf(worker, 'worker')))
  }

  // @ts-expect-error Typert reads the options object at build time.
  @Remote({ name: 'baseGet', resources: { session: (sessionId: string) => sessionId } })
  baseGet(sessionId: string): string {
    this.assertOwner()
    return JSON.stringify(this.admin().baseGet(sessionIdOf(sessionId, 'sessionId')))
  }

  // @ts-expect-error Typert reads the options object at build time.
  @Remote({ name: 'baseSet', resources: { session: (sessionId: string) => sessionId } })
  baseSet(sessionId: string, value: string): string {
    this.assertOwner()
    return JSON.stringify(this.admin().baseSet(sessionIdOf(sessionId, 'sessionId'), value))
  }

  // @ts-expect-error Typert reads the options object at build time.
  @Remote({ name: 'panel', resources: { session: (sessionId: string) => sessionId } })
  panel(sessionId: string, operation: string, argsJson: string): string {
    this.assertOwner()
    const checkedSessionId = sessionId === undefined ? '' : sessionId
    if (!SESSION_ID.test(checkedSessionId)) throw new Error(`Invalid sessionId: ${checkedSessionId}`)
    let args: Record<string, unknown> = {}
    if (argsJson.trim().length > 0) {
      const parsed: unknown = JSON.parse(argsJson)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('panel args must be a JSON object')
      args = parsed as Record<string, unknown>
    }
    return JSON.stringify(this.admin().panel(checkedSessionId, operation, args))
  }
}

/**
 * Mount the generated Host service.
 * @param ctx - owning Host Context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(CollabAuthService)
}


declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Collaboration authorization service exposed by the collab plugin. */
    collabAdmin: CollabAdminFace
    /** Generated Remote service backing the authorization page. */
    collabAuth: CollabAuthService
  }
}
