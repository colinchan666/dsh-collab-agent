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
/** Host service backing the generated `ctx.remote.collabAuth` namespace. */
let CollabAuthService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _list_decorators;
    let _authorize_decorators;
    let _revoke_decorators;
    return class CollabAuthService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _list_decorators = [Remote('list')];
            _authorize_decorators = [Remote('authorize')];
            _revoke_decorators = [Remote('revoke')];
            __esDecorate(this, null, _list_decorators, { kind: "method", name: "list", static: false, private: false, access: { has: obj => "list" in obj, get: obj => obj.list }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _authorize_decorators, { kind: "method", name: "authorize", static: false, private: false, access: { has: obj => "authorize" in obj, get: obj => obj.authorize }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _revoke_decorators, { kind: "method", name: "revoke", static: false, private: false, access: { has: obj => "revoke" in obj, get: obj => obj.revoke }, metadata: _metadata }, null, _instanceExtraInitializers);
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
            return this.admin().listAuth();
        }
        /**
         * Authorize both directions of a pair.
         * @param a - first Session id.
         * @param b - second Session id.
         * @returns the resulting authorization snapshot.
         */
        authorize(a, b) {
            return this.admin().authorize(sessionId(a, 'a'), sessionId(b, 'b'));
        }
        /**
         * Revoke both directions of a pair.
         * @param a - first Session id.
         * @param b - second Session id.
         * @returns the resulting authorization snapshot.
         */
        revoke(a, b) {
            return this.admin().revoke(sessionId(a, 'a'), sessionId(b, 'b'));
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
