/** Minimal build-time declaration shim for the Typert protocol meta symbols. */
export declare function Remote(target: object, context: unknown): void
export declare function Remote(name: string): (target: object, context: unknown) => void
export declare abstract class TypertRemoteService<T = never> {
  protected readonly ctx: { get(name: string): any }
  protected constructor(ctx: unknown, serviceKey: string, options?: { readonly namespace?: string })
}
export declare function bindTypertRemote(service: unknown, serviceKey: string, options?: { readonly namespace?: string }): unknown
