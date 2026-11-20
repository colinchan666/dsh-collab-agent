/**
 * Client contribution: mount the generated authorization Remote namespace.
 * The UI plugin injects `remote.collabAuth` and never executes a command.
 */

import type { Context } from '@deepseek-ai/cordis'
import remote from '../lib/typert.remote-client.js'

/** The API Gateway's typed Remote service must exist before mounting. */
export const inject = ['remote']

/**
 * Mount the generated contribution for the lifetime of this Client plugin.
 * @param ctx - owning Client Context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.remote.$mount(remote), 'collab-auth-api.remote')
}
