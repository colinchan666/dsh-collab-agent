/** Host runtime for the generated authorization Remote. */

/**
 * Provide the service object under the generated service key. The Typert
 * gateway already owns the generated strict invocation descriptors, so the
 * runtime only has to expose the methods the descriptors name.
 * @param ctx - owning Host Context.
 */
export function apply(ctx: any): void {
  const admin = () => {
    const face = ctx.get('collabAdmin')
    if (face === undefined) throw new Error('collabAdmin is not available')
    return face
  }
  const service: any = {
    list: () => admin().listAuth(),
    authorize: (a: string, b: string) => admin().authorize(a, b),
    revoke: (a: string, b: string) => admin().revoke(a, b),
    panel: (sessionId: string, operation: string, argsJson: string) => {
      let args: Record<string, unknown> = {}
      if (argsJson.trim().length > 0) {
        const parsed: unknown = JSON.parse(argsJson)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('panel args must be a JSON object')
        args = parsed as Record<string, unknown>
      }
      return JSON.stringify(admin().panel(sessionId, operation, args))
    },
  }
  service.typertRemote = { service, serviceKey: 'collabAuth', namespace: 'collabAuth' }
  ctx.provide('collabAuth', service)
}
