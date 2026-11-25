/** Host runtime for the generated authorization Remote. */
/**
 * Provide the service object under the generated service key. The Typert
 * gateway already owns the generated strict invocation descriptors, so the
 * runtime only has to expose the methods the descriptors name.
 * @param ctx - owning Host Context.
 */
export function apply(ctx) {
    const assertOwner = () => {
        const principal = ctx.invocation?.peer?.principal;
        if (principal !== undefined && principal.kind !== 'owner')
            throw new Error('collaboration management is owner-only');
    };
    const admin = () => {
        const face = ctx.get('collabAdmin');
        if (face === undefined)
            throw new Error('collabAdmin is not available');
        return face;
    };
    const service = {
        list: () => { assertOwner(); return admin().listAuth(); },
        authorize: (a, b) => { assertOwner(); return admin().authorize(a, b); },
        revoke: (a, b) => { assertOwner(); return admin().revoke(a, b); },
        board: (sessionId) => { assertOwner(); return JSON.stringify(admin().board(sessionId)); },
        link: (sessionId, worker, payloadJson) => {
            assertOwner();
            let payload = {};
            if (payloadJson.trim().length > 0) {
                const parsed = JSON.parse(payloadJson);
                if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
                    throw new Error('link payload must be a JSON object');
                payload = parsed;
            }
            return JSON.stringify(admin().link(sessionId, worker, payload));
        },
        unlink: (sessionId, worker) => { assertOwner(); return JSON.stringify(admin().unlink(sessionId, worker)); },
        pin: (sessionId, worker) => { assertOwner(); return JSON.stringify(admin().pin(sessionId, worker)); },
        live: (sessionId, worker) => { assertOwner(); return JSON.stringify(admin().live(sessionId, worker)); },
        baseGet: (sessionId) => { assertOwner(); return JSON.stringify(admin().baseGet(sessionId)); },
        baseSet: (sessionId, value) => { assertOwner(); return JSON.stringify(admin().baseSet(sessionId, value)); },
        panel: (sessionId, operation, argsJson) => {
            assertOwner();
            let args = {};
            if (argsJson.trim().length > 0) {
                const parsed = JSON.parse(argsJson);
                if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
                    throw new Error('panel args must be a JSON object');
                args = parsed;
            }
            return JSON.stringify(admin().panel(sessionId, operation, args));
        },
    };
    service.typertRemote = { service, serviceKey: 'collabAuth', namespace: 'collabAuth' };
    ctx.provide('collabAuth', service);
}
