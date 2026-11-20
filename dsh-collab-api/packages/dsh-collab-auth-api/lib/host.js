/** Host runtime for the generated authorization Remote. */
/**
 * Provide the service object under the generated service key. The Typert
 * gateway already owns the generated strict invocation descriptors, so the
 * runtime only has to expose the methods the descriptors name.
 * @param ctx - owning Host Context.
 */
export function apply(ctx) {
    const admin = () => {
        const face = ctx.get('collabAdmin');
        if (face === undefined)
            throw new Error('collabAdmin is not available');
        return face;
    };
    const service = {
        list: () => admin().listAuth(),
        authorize: (a, b) => admin().authorize(a, b),
        revoke: (a, b) => admin().revoke(a, b),
    };
    service.typertRemote = { service, serviceKey: 'collabAuth', namespace: 'collabAuth' };
    ctx.provide('collabAuth', service);
}
