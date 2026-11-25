/**
 * Host authorization Remote: the human-facing pair list and the two
 * user-only mutations. Transport is generated Typert Remote, so the UI never
 * needs a control Session or a slash command.
 */
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
/** Diagnostic marker for the first Host mount. */
/** Session ids minted by DSH. */
const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** Reject ids that could not name a Session before touching the stores. */
function sessionId(value, parameter) {
    if (!SESSION_ID.test(value))
        throw new Error(`Invalid ${parameter}: ${value}`);
    return value;
}
function sessionIdOf(value, parameter) {
    return sessionId(value, parameter);
}
/** Host service backing the generated `ctx.remote.collabAuth` namespace. */
let CollabAuthService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _list_decorators;
    let _authorize_decorators;
    let _revoke_decorators;
    let _board_decorators;
    let _link_decorators;
    let _unlink_decorators;
    let _pin_decorators;
    let _live_decorators;
    let _baseGet_decorators;
    let _baseSet_decorators;
    let _panel_decorators;
    return class CollabAuthService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _list_decorators = [Remote('list')];
            _authorize_decorators = [Remote({ name: 'authorize', resources: { session: (a, b) => [a, b] } })];
            _revoke_decorators = [Remote({ name: 'revoke', resources: { session: (a, b) => [a, b] } })];
            _board_decorators = [Remote({ name: 'board', resources: { session: (sessionId) => sessionId } })];
            _link_decorators = [Remote({ name: 'link', resources: { session: (sessionId) => sessionId } })];
            _unlink_decorators = [Remote({ name: 'unlink', resources: { session: (sessionId) => sessionId } })];
            _pin_decorators = [Remote({ name: 'pin', resources: { session: (sessionId) => sessionId } })];
            _live_decorators = [Remote({ name: 'live', resources: { session: (sessionId) => sessionId } })];
            _baseGet_decorators = [Remote({ name: 'baseGet', resources: { session: (sessionId) => sessionId } })];
            _baseSet_decorators = [Remote({ name: 'baseSet', resources: { session: (sessionId) => sessionId } })];
            _panel_decorators = [Remote({ name: 'panel', resources: { session: (sessionId) => sessionId } })];
            __esDecorate(this, null, _list_decorators, { kind: "method", name: "list", static: false, private: false, access: { has: obj => "list" in obj, get: obj => obj.list }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _authorize_decorators, { kind: "method", name: "authorize", static: false, private: false, access: { has: obj => "authorize" in obj, get: obj => obj.authorize }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _revoke_decorators, { kind: "method", name: "revoke", static: false, private: false, access: { has: obj => "revoke" in obj, get: obj => obj.revoke }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _board_decorators, { kind: "method", name: "board", static: false, private: false, access: { has: obj => "board" in obj, get: obj => obj.board }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _link_decorators, { kind: "method", name: "link", static: false, private: false, access: { has: obj => "link" in obj, get: obj => obj.link }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _unlink_decorators, { kind: "method", name: "unlink", static: false, private: false, access: { has: obj => "unlink" in obj, get: obj => obj.unlink }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _pin_decorators, { kind: "method", name: "pin", static: false, private: false, access: { has: obj => "pin" in obj, get: obj => obj.pin }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _live_decorators, { kind: "method", name: "live", static: false, private: false, access: { has: obj => "live" in obj, get: obj => obj.live }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _baseGet_decorators, { kind: "method", name: "baseGet", static: false, private: false, access: { has: obj => "baseGet" in obj, get: obj => obj.baseGet }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _baseSet_decorators, { kind: "method", name: "baseSet", static: false, private: false, access: { has: obj => "baseSet" in obj, get: obj => obj.baseSet }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _panel_decorators, { kind: "method", name: "panel", static: false, private: false, access: { has: obj => "panel" in obj, get: obj => obj.panel }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        /** Required Host services: the collaborator admin face and Typert registration. */
        static inject = ['typert'];
        /**
         * Bind the service to the generated namespace.
         * @param ctx - owning Host Context.
         */
        constructor(ctx) {
            super(ctx, 'collabAuth', { namespace: 'collabAuth' });
            __runInitializers(this, _instanceExtraInitializers);
        }
        /**
         * Preserve the management surface's owner-only policy. The generated
         * resource readers still describe the sessions each call touches; a future
         * non-owner grant cannot bypass this check accidentally.
         */
        assertOwner() {
            const invocation = this.ctx.invocation;
            const principal = invocation?.peer?.principal;
            if (principal !== undefined && principal.kind !== 'owner') {
                throw new Error('collaboration management is owner-only');
            }
        }
        /**
         * Resolve the collaborator admin face at call time so a later Host reload
         * can replace it without re-mounting this Remote service.
         * @returns the live admin face.
         */
        admin() {
            const admin = this.ctx.get('collabAdmin');
            if (admin === undefined)
                throw new Error('collabAdmin is not available');
            return admin;
        }
        /**
         * Read entirely authorized pairs and one-sided pending grants.
         * @returns the current authorization snapshot.
         */
        list() {
            this.assertOwner();
            return this.admin().listAuth();
        }
        /**
         * Authorize both directions of a pair.
         * @param a - first Session id.
         * @param b - second Session id.
         * @returns the resulting authorization snapshot.
         */
        // @ts-expect-error Typert reads the options object at build time.
        authorize(a, b) {
            this.assertOwner();
            return this.admin().authorize(sessionId(a, 'a'), sessionId(b, 'b'));
        }
        /**
         * Revoke both directions of a pair.
         * @param a - first Session id.
         * @param b - second Session id.
         * @returns the resulting authorization snapshot.
         */
        // @ts-expect-error Typert reads the options object at build time.
        revoke(a, b) {
            this.assertOwner();
            return this.admin().revoke(sessionId(a, 'a'), sessionId(b, 'b'));
        }
        /**
         * Read the supervisor board.
         * @param sessionId - collaboration Session id.
         * @returns JSON board snapshot.
         */
        // @ts-expect-error Typert reads the options object at build time.
        board(sessionId) {
            this.assertOwner();
            return JSON.stringify(this.admin().board(sessionIdOf(sessionId, 'sessionId')));
        }
        // @ts-expect-error Typert reads the options object at build time.
        link(sessionId, worker, payloadJson) {
            this.assertOwner();
            const id = sessionIdOf(sessionId, 'sessionId');
            const peer = sessionIdOf(worker, 'worker');
            let payload = {};
            if (payloadJson.trim().length > 0) {
                const parsed = JSON.parse(payloadJson);
                if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
                    throw new Error('link payload must be a JSON object');
                payload = parsed;
            }
            return JSON.stringify(this.admin().link(id, peer, payload));
        }
        // @ts-expect-error Typert reads the options object at build time.
        unlink(sessionId, worker) {
            this.assertOwner();
            return JSON.stringify(this.admin().unlink(sessionIdOf(sessionId, 'sessionId'), sessionIdOf(worker, 'worker')));
        }
        // @ts-expect-error Typert reads the options object at build time.
        pin(sessionId, worker) {
            this.assertOwner();
            return JSON.stringify(this.admin().pin(sessionIdOf(sessionId, 'sessionId'), sessionIdOf(worker, 'worker')));
        }
        // @ts-expect-error Typert reads the options object at build time.
        live(sessionId, worker) {
            this.assertOwner();
            return JSON.stringify(this.admin().live(sessionIdOf(sessionId, 'sessionId'), sessionIdOf(worker, 'worker')));
        }
        // @ts-expect-error Typert reads the options object at build time.
        baseGet(sessionId) {
            this.assertOwner();
            return JSON.stringify(this.admin().baseGet(sessionIdOf(sessionId, 'sessionId')));
        }
        // @ts-expect-error Typert reads the options object at build time.
        baseSet(sessionId, value) {
            this.assertOwner();
            return JSON.stringify(this.admin().baseSet(sessionIdOf(sessionId, 'sessionId'), value));
        }
        /**
         * Read or mutate a supervisor management surface without a slash command.
         * @param sessionId - collaboration Session id.
         * @param operation - board, baseGet, baseSet, link, unlink, pin, or live.
         * @param argsJson - JSON operation payload.
         * @returns JSON operation result.
         */
        // @ts-expect-error Typert reads the options object at build time.
        panel(sessionId, operation, argsJson) {
            this.assertOwner();
            const checkedSessionId = sessionId === undefined ? '' : sessionId;
            if (!SESSION_ID.test(checkedSessionId))
                throw new Error(`Invalid sessionId: ${checkedSessionId}`);
            let args = {};
            if (argsJson.trim().length > 0) {
                const parsed = JSON.parse(argsJson);
                if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
                    throw new Error('panel args must be a JSON object');
                args = parsed;
            }
            return JSON.stringify(this.admin().panel(checkedSessionId, operation, args));
        }
    };
})();
export { CollabAuthService };
/**
 * Mount the generated Host service.
 * @param ctx - owning Host Context.
 */
export function apply(ctx) {
    ctx.plugin(CollabAuthService);
}
