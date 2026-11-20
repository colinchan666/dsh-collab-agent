/** Host runtime for the generated authorization Remote. */
/**
 * Provide the service object under the generated service key. The Typert
 * gateway already owns the generated strict invocation descriptors, so the
 * runtime only has to expose the methods the descriptors name.
 * @param ctx - owning Host Context.
 */
export declare function apply(ctx: any): void;
