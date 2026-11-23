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
    return this.admin().listAuth()
  }

  /**
   * Authorize both directions of a pair.
   * @param a - first Session id.
   * @param b - second Session id.
   * @returns the resulting authorization snapshot.
   */
  @Remote('authorize')
  authorize(a: string, b: string): AuthSnapshot {
    return this.admin().authorize(sessionId(a, 'a'), sessionId(b, 'b'))
  }

  /**
   * Revoke both directions of a pair.
   * @param a - first Session id.
   * @param b - second Session id.
   * @returns the resulting authorization snapshot.
   */
  @Remote('revoke')
  revoke(a: string, b: string): AuthSnapshot {
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
  @Remote('panel')
  panel(sessionId: string, operation: string, argsJson: string): string {
    let args: Record<string, unknown> = {}
    if (argsJson.trim().length > 0) {
      const parsed: unknown = JSON.parse(argsJson)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('panel args must be a JSON object')
      args = parsed as Record<string, unknown>
    }
    return JSON.stringify(this.admin().panel(sessionId, operation, args))
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
