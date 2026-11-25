# dsh-collab-auth-api

Generated Typert Remote workspace for the collaboration authorization page.

The plugin's **协作授权** page uses this package instead of a control-session
slash command. The Host service backs `ctx.remote.collabAuth` with `list`,
`authorize`, and `revoke`.

## Build

Requirements: Node.js, pnpm, and the DSH Typert generator (`@deepseek-ai/dsh-typert-generator`).

```sh
cd dsh-collab-api
pnpm install
pnpm build
```

`pnpm build`:

1. runs the Typert generator over `packages/dsh-collab-auth-api`;
2. writes `lib/typert.host.js`, `lib/typert.remote-client.js`, and their types;
3. compiles the plain Host runtime (`lib/host.js`);
4. bundles the client contribution (`lib/client.js`).

The build workspace contains a small `packages/typert/protocol` shim so the
generator can recognize the Typert meta symbols without pulling in the entire
DSH workspace. The API package itself declares the real
`@deepseek-ai/dsh-typert-protocol` dependency for runtime.

The package is published as `@xmodelin/dsh-collab-auth-api` and depended on by
`@xmodelin/dsh-collab-sessions`; the sessions patch inserts its loader row. Do
not enable the API as a second bundle when using npm. After rebuilding,
re-enable the sessions bundle and refresh the Web client.
