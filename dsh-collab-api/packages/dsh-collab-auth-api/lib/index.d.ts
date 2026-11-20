/**
 * Host authorization Remote: the human-facing pair list and the two
 * user-only mutations. Transport is generated Typert Remote, so the UI never
 * needs a control Session or a slash command.
 */
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { Context } from '@deepseek-ai/cordis';
import type { AuthSnapshot, CollabAdminFace } from './types.js';
export type * from './types.js';
/** Host service backing the generated `ctx.remote.collabAuth` namespace. */
export declare class CollabAuthService extends TypertRemoteService {
    /** Required Host services: the collaborator admin face and Typert registration. */
    static inject: string[];
    /**
     * Bind the service to the generated namespace.
     * @param ctx - owning Host Context.
     */
    constructor(ctx: Context);
    /**
     * Resolve the collaborator admin face at call time so a later Host reload
     * can replace it without re-mounting this Remote service.
     * @returns the live admin face.
     */
    private admin;
    /**
     * Read entirely authorized pairs and one-sided pending grants.
     * @returns the current authorization snapshot.
     */
    list(): AuthSnapshot;
    /**
     * Authorize both directions of a pair.
     * @param a - first Session id.
     * @param b - second Session id.
     * @returns the resulting authorization snapshot.
     */
    authorize(a: string, b: string): AuthSnapshot;
    /**
     * Revoke both directions of a pair.
     * @param a - first Session id.
     * @param b - second Session id.
     * @returns the resulting authorization snapshot.
     */
    revoke(a: string, b: string): AuthSnapshot;
}
/**
 * Mount the generated Host service.
 * @param ctx - owning Host Context.
 */
export declare function apply(ctx: Context): void;
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Collaboration authorization service exposed by the collab plugin. */
        collabAdmin: CollabAdminFace;
        /** Generated Remote service backing the authorization page. */
        collabAuth: CollabAuthService;
    }
}
