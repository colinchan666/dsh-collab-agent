# @xmodelin/dsh-collab-auth-api

Generated Typert Remote for the DeepSeek Harness collaboration authorization
page. It backs `ctx.remote.collabAuth` with `list`, `authorize`, `revoke`, and
the owner-only management panel.

This package is normally installed as a dependency of
[`@xmodelin/dsh-collab-sessions`](https://www.npmjs.com/package/@xmodelin/dsh-collab-sessions).
The sessions bundle's patch inserts this package's Host row; do not enable the
API as a second bundle when installing from npm.

The generated `lib/` is committed. Rebuild it only after changing the API
source:

```sh
cd dsh-collab-api
pnpm install
pnpm build
```
