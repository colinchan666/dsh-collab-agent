# DSH Collab Sessions

A DeepSeek Harness plugin for **collaboration between sessions**:

- a **Collab** entry in the left sidebar's New-session row;
- two bundled Agent presets: **协同会话 (Collab session)** and
  **超级会话 (Supervisor session)**;
- per-session working directories under `.dsh-collab/sessions/<sessionId>/`;
- authenticated peer messaging, gated by **bilateral human authorization**;
- supervisor/worker task coordination with parent **tasks** and worker
  **subtasks**;
- canonical delivery directories and sanitized delivery manifests.

Activating the sidebar entry starts a New Session under the selected preset **in
the currently selected Workspace** — the same target the built-in New Session
button uses. It does not create a new Workspace per session.

## Features

| Area | Behavior |
|---|---|
| Session identity | Host `session-<uuid>` id, also stored in `session.json` |
| Working layout | Per-session `private/`, `comm/`, and `session.json`; no new Workspace |
| Messaging | HMAC-authenticated `collab_send` / `collab_inbox` between collab sessions |
| Authorization | Both directions must be granted in **协同授权 / Collab access** |
| Task model | A request becomes a task; a supervisor assigns subtasks to workers |
| Delivery | Workers publish under `shared/<taskId>/artifacts`; requester gets an opaque manifest |
| Boards | **任务列表** and **注册中心** in the supervisor's right sidebar |
| Preset visibility | Collab presets are hidden from ordinary New-session menus; DSH core locks preset changes after the first turn |
| Windows | Uses PowerShell instead of Bash; per-session OS sandbox is disabled and the collaboration guard remains the boundary |

## Repository layout

```text
dsh-plugins-collab-agent/
  README.md                              this file — overview and installation
  dsh-collab/                            Host + Client plugin bundle
    README.md                            detailed behavior and development docs
    cordis.patch.yml                     bundles and preset definitions
  dsh-collab-api/
    packages/dsh-collab-auth-api/        generated Typert authorization Remote
```

Two packages are involved:

- `@xmodelin/dsh-collab-sessions` — the installable bundle (Host plugin,
  presets, sidebar/boards, client);
- `@xmodelin/dsh-collab-auth-api` — the generated authorization Remote and
  client bundle. It is a package dependency, and the sessions bundle's patch
  activates its loader row. Do not select it as a second bundle when using npm.

## Requirements

- DeepSeek Harness Desktop with the plugin manager (profile normally
  `~/.dsh/profiles/desktop`).
- Node.js and pnpm for the optional API dependency install/build.
- macOS, Linux, or Windows. See the Windows notes below.

## Install from npm (recommended)

The npm package is:

```text
@xmodelin/dsh-collab-sessions
```

It declares `@xmodelin/dsh-collab-auth-api` as a dependency, and its bundled
`cordis.patch.yml` inserts the authorization API row. Installing the sessions
bundle therefore installs and activates both halves.

Target release:

```text
@xmodelin/dsh-collab-sessions@0.0.12
@xmodelin/dsh-collab-auth-api@0.0.12
```

If `npm view` returns 404 for `0.0.12`, the release is staged and must be
approved first:

```sh
npx npm@latest stage list
npx npm@latest stage approve <stage-id>
```

Verify the registry before installing:

```sh
npm view @xmodelin/dsh-collab-auth-api version
npm view @xmodelin/dsh-collab-sessions version
```

Both should print `0.0.12`.

1. In DSH open **Plugins** and add an npm package, or install the bundle with
   the plugin manager using this spec:

   ```text
   @xmodelin/dsh-collab-sessions@0.0.12
   ```

2. Do **not** separately install or enable `@xmodelin/dsh-collab-auth-api`; its
   loader row comes from the sessions patch. If an older two-bundle local
   install exists, remove both old bundle entries first.

3. Completely quit and reopen DSH.

4. Open a Workspace and use the sidebar's **协同会话** / **超级会话** entries.

If the npm scope is not owned by the publishing account, rename both packages
and the patch rows before publishing; scoped npm packages require access to the
scope.

## Local development installation

### 1. Clone the repository

```sh
git clone https://github.com/colinchan666/dsh-plugins-collab-agent.git
cd dsh-plugins-collab-agent
```

The generated API `lib/` is committed; a build is normally not needed. Install
the API workspace dependencies so the package can be linked:

```sh
cd dsh-collab-api
pnpm install
```

### 2. Link both package directories into the DSH profile

The package names are already `@xmodelin/...`, so use these exact directory
names.

macOS/Linux:

```sh
PROFILE="$HOME/.dsh/profiles/desktop"
REPO="$HOME/src/dsh-plugins-collab-agent"
mkdir -p "$PROFILE/node_modules/@xmodelin"
ln -s "$REPO/dsh-collab" "$PROFILE/node_modules/@xmodelin/dsh-collab-sessions"
ln -s "$REPO/dsh-collab-api/packages/dsh-collab-auth-api" \
  "$PROFILE/node_modules/@xmodelin/dsh-collab-auth-api"
```

Windows PowerShell (junctions work without Developer Mode):

```powershell
$ProfileDir = "$env:USERPROFILE\.dsh\profiles\desktop"
$Repo = "C:\src\dsh-plugins-collab-agent"
New-Item -ItemType Directory -Force "$ProfileDir\node_modules\@xmodelin" | Out-Null
New-Item -ItemType Junction -Path "$ProfileDir\node_modules\@xmodelin\dsh-collab-sessions" `
  -Target "$Repo\dsh-collab"
New-Item -ItemType Junction -Path "$ProfileDir\node_modules\@xmodelin\dsh-collab-auth-api" `
  -Target "$Repo\dsh-collab-api\packages\dsh-collab-auth-api"
```

Replace `$REPO` / `$Repo` with the actual checkout path.

### 3. Enable the sessions bundle

Enable only:

```text
@xmodelin/dsh-collab-sessions
```

Its patch inserts the authorization API row. Do not also enable
`@xmodelin/dsh-collab-auth-api` as a separate bundle, or the loader row is
duplicated.

Then **completely quit and reopen DSH**. A page refresh or bundle reload is not
enough for Host and client changes.

### 4. Verify the installation

1. Open a Workspace.
2. Open the left sidebar's New-session dropdown and choose **协同会话** or
   **超级会话**.
3. Open the right sidebar once; a supervisor session seeds **任务列表** and
   **注册中心**.
4. Open **协同授权 / Collab access** and authorize a pair.
5. Create and switch Workspaces while a collab session is active; the new
   Workspace blank should keep the collab preset.

### 5. Rebuild the API (only when needed)

```sh
cd dsh-collab-api
pnpm install
pnpm build
```

Rebuild only if the generated `lib/` is absent or its source changed.

## Configuration

The default shared delivery root is:

```text
<dsh home>/collab/shared
```

Override it with `sharedRoot` under the `dsh-collab-sessions` config. It must be
an absolute path writable by the DSH process. On Windows use a native path, for
example `C:/Users/me/.dsh/collab/shared`.

Other relevant options:

| Option | Default | Purpose |
|---|---:|---|
| `executionTimeoutMs` | `86400000` | Accepted-request execution deadline |
| `perSessionSandbox` | `true` | Narrow the OS sandbox to the session's delivery root where supported |
| `lockTimeoutMs` | `1000` | Cross-process state-lock wait |
| `lockStaleMs` | `10000` | Stale state-lock recovery |

`perSessionSandbox` is active on macOS/Linux only when the profile provides
DSH's `sandboxPolicy` and OS sandbox provider. On Windows it is forced off:
extra writable roots apply to file tools but not to sandboxed shell processes, so
worker delivery writes would fail. The collaboration guard handles PowerShell
writes instead.

## Preset behavior

The sidebar entry creates sessions under the bundled presets. Ordinary
New-session and Workspace pickers do not display the collab presets; the client
filters their menus, and DSH core rejects changing a session preset after its
first turn.

This is UI-level exclusion, not a cryptographic entry token: a direct API call
that names a collab preset is still possible. Strict creation-origin enforcement
would require a DSH core entry-token API.

## Documentation

- [`dsh-collab/README.md`](dsh-collab/README.md) — detailed architecture,
  authorization, task/subtask state, delivery, manual state repair, and Windows
  behavior.
- [`dsh-collab-api/README.md`](dsh-collab-api/README.md) — generated
  authorization Remote workspace and build details.

## Publishing to npm

The API package must be published first because the sessions package depends on
its exact version.

```sh
cd dsh-collab-api/packages/dsh-collab-auth-api
npm publish --access public

cd ../../../dsh-collab
npm publish --access public
```

Before publishing:

- log in with an account that owns the `@xmodelin` scope;
- bump **both** versions together;
- update the sessions dependency to the new API version;
- run `npm pack --dry-run` in each package and confirm the generated `lib/`,
  `cordis.patch.yml`, locale files, and icon are present;
- rebuild the API if its generated `lib/` changed.

Both packages use `publishConfig.access = public`, so `npm publish` publishes a
public scoped package. Version `0.0.12` is the current staged release. Approve the staged auth API
version first, then the staged sessions version (it depends on the API). For
the next release, bump both versions together and update the sessions
dependency before publishing.

## Development

```sh
cd dsh-collab
npm test
DSH_BROWSER_TEST=1 npm run test:browser

cd ../dsh-collab-api
node --test packages/dsh-collab-auth-api/test/host.test.mjs
```

The browser smoke test needs a reachable DSH Web GUI; supervisor-tab coverage
requires `DSH_BROWSER_SUPERVISOR_TITLE` naming an existing supervisor session.

The `collab` preset is a copy of the shipped `standard` preset. When upgrading
DSH, re-sync `dsh-collab/cordis.patch.yml` from the installed
`dsh-web-app/presets/standard.patch.yml`.

## Release branch

The current release line is `release-v0.0.12`. Both it and `main` must stay in
sync for plugin-only changes.
