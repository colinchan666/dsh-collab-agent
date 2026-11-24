# Collab sessions

A DeepSeek Harness plugin that adds a **Collab** entry to the left sidebar's
New-session row. Activating it starts a New Session under the bundled `collab`
Agent preset **in the currently selected Workspace** (the same target the
built-in New Session button uses: the current Session's Workspace, then the
recent Workspace). It does not create a new Workspace per session.

## Installing in another DSH profile

This repository contains two bundles that must both be installed and enabled:

- `@xmodelin/dsh-collab-sessions` — Host plugin, presets, sidebar/board client;
- `@xmodelin/dsh-collab-auth-api` — generated authorization Remote and client
  bundle. The collab client injects it, so enabling only the first bundle leaves
  the auth/board Remote unavailable.

Steps:

1. Clone this repository and install the API workspace dependencies (the
   generated `lib/` is already committed; a build is not normally needed):

   ```sh
   git clone https://github.com/colinchan666/dsh-collab-agent.git
   cd dsh-collab-agent/dsh-collab-api
   pnpm install
   ```

2. Link both package directories into the target DSH profile. The profile is
   normally `~/.dsh/profiles/desktop` for Desktop. The package names are already
   `@xmodelin/...`, so use these exact directory names.

   macOS/Linux:

   ```sh
   PROFILE="$HOME/.dsh/profiles/desktop"
   REPO="$HOME/src/dsh-collab-agent"
   mkdir -p "$PROFILE/node_modules/@xmodelin"
   ln -s "$REPO/dsh-collab" "$PROFILE/node_modules/@xmodelin/dsh-collab-sessions"
   ln -s "$REPO/dsh-collab-api/packages/dsh-collab-auth-api" \
     "$PROFILE/node_modules/@xmodelin/dsh-collab-auth-api"
   ```

   Windows PowerShell (junctions work without Developer Mode):

   ```powershell
   $ProfileDir = "$env:USERPROFILE\.dsh\profiles\desktop"
   $Repo = "C:\src\dsh-collab-agent"
   New-Item -ItemType Directory -Force "$ProfileDir\node_modules\@xmodelin" | Out-Null
   New-Item -ItemType Junction -Path "$ProfileDir\node_modules\@xmodelin\dsh-collab-sessions" `
     -Target "$Repo\dsh-collab"
   New-Item -ItemType Junction -Path "$ProfileDir\node_modules\@xmodelin\dsh-collab-auth-api" `
     -Target "$Repo\dsh-collab-api\packages\dsh-collab-auth-api"
   ```

3. By default the release uses `<dsh home>/collab/shared`. To use another
   location, add a `sharedRoot` under the `dsh-collab-sessions` config; it must
   be an absolute path writable by the DSH process. For Windows use a native
   path, for example `C:/Users/me/.dsh/collab/shared`.

4. `perSessionSandbox` is active on macOS/Linux only when the profile provides
   DSH's `sandboxPolicy` and OS sandbox provider. On Windows it is forced off:
   DSH's extra writable roots apply to file tools but not to sandboxed shell
   processes, so the worker's delivery writes would fail. Windows relies on the
   collaboration guard for PowerShell writes instead.

5. Enable both bundles in the DSH plugin manager, in this order:

   ```text
   @xmodelin/dsh-collab-auth-api
   @xmodelin/dsh-collab-sessions
   ```

   Then completely quit and reopen DSH. A page refresh or bundle reload is not
   enough for client code.

6. After restart, create a collab session, open its right sidebar once, confirm
   the start/tasks/registration tabs, and authorize a pair in **Collab access**.

7. Rebuild the API only if its generated `lib/` is absent or its source changed:

   ```sh
   cd dsh-collab-api
   pnpm install
   pnpm build
   ```

The `collab` preset is a copy of the shipped `standard` preset; when upgrading
DSH, re-sync `cordis.patch.yml` from the installed
`dsh-web-app/presets/standard.patch.yml`.

## What a collab session gets

1. **A unique session ID.** The Host session id (`session-<uuid>`) is stored in
   `session.json`, returned by `collab_info`, and used as the address other
   sessions send messages to.
2. **Explicitly authorized session-to-session messaging.** The `collab_*`
   tools exchange HMAC-authenticated messages with another collab session, but
   only after a human authorizes the pair. A cold target is resumed, a live
   target is woken, and the browser activates the target's Session page when it
   starts running. The message body is read through `collab_inbox`.
3. **A two-directory working layout.** The Session stays in its Workspace and
   gets a per-session working directory inside it:

   ```text
   <workspace>/.dsh-collab/sessions/<sessionId>/
     comm/
       <peerSessionId>/
         credential.json        shared pair secret
         inbox/*.json          unread inbound messages
         outbox/*.json         sent messages (normal)
         archive/inbox/*.json  read inbound messages
         archive/outbox/       explicitly archived sent messages (normal sends stay in outbox/)
         rejected/             quarantined invalid or oversized files
     private/              session-only data (mode 0700)
     session.json          layout metadata
   ```

## Authorization

Only **collaboration sessions** can communicate with each other. Every
communication pair must be authorized explicitly and **bilaterally**: A must
authorize B and B must authorize A. A single-sided grant is shown as pending
but does not open the gate.

Open **Collab access** (协作授权) from the left sidebar panel list:

- **已授权会话对** — pairs where both sides have authorized, with a **Revoke**
  action for each. One-sided grants appear below them as pending until the
  other side grants too.
- **协作会话** — every collaboration session. Select exactly two and click
  **Authorize both sides**.

The gate is enforced on both sides: `collab_send` requires both directional
grants, and delivery plus `collab_inbox` re-check them. Revoking removes both
directions immediately, stops new sends, and hides already queued messages from
`collab_inbox` until both sides are authorized again.

The page is a generated Host Remote (`ctx.remote.collabAuth`), not a session
command: it needs no control session and leaves no `/collab-auth` row in any
conversation. The Host commands remain available for manual debugging:

```text
/collab-auth list
/collab-auth authorize <sessionA> <sessionB>   # both directions
/collab-auth grant <fromSession> <toSession>   # one direction
/collab-auth revoke <sessionA> <sessionB>      # both directions
```

## Authorization Remote (development)

The auth page is backed by a separate generated Typert package in
`../dsh-collab-api`:

```text
dsh-collab-api/
  packages/dsh-collab-auth-api/   Host service + generated Remote artifacts
  tsconfig.host.json              workspace face for generation
```

Build it with the DSH Typert generator:

```sh
cd ../dsh-collab-api
pnpm install
pnpm build
```

This emits `lib/typert.host.js`, `lib/typert.remote-client.js`, and the bundled
`lib/client.js`. The profile links `@xmodelin/dsh-collab-auth-api` as a bundle;
after rebuilding, disable/enable that bundle (or restart DSH) and refresh the
Web client so the generated `remote.collabAuth` namespace remounts. Board, base
prompt, and link actions also use `collabAuth.panel`; they do not add command
rows to the conversation.

## Base prompt

Every collaboration session can carry its own **base prompt** — a baseline
instruction injected at the top of that session's collaboration prompt on every
turn. Use it for a role ("you are the reviewer") and hard constraints ("never
edit files; answer in Chinese"). It is per session and persists in the session's
`session.json` across resumes.

Three entry points open the same editor:

- **New collab session** — the **设置提示词** button in the workspace / mode
  row, styled like those chips. It opens the same editor; the button disappears
  after the first message.
- **Right-click** the session row in the left sidebar → **设置基准提示词**.
- The session header's **更多 / More** menu → **设置基准提示词**.

The editor loads the current text, saves it, and the next turn picks it up.
The Host command is also available:

```text
/collab-base get
/collab-base set <base64-of-the-prompt>
```

## Supervisor sessions

The Collab button is a dropdown with **协作会话** and **超级会话**. A supervisor
session is a coordination-only preset: no shell, files, office, web, or edit
tools. It uses task tools to plan/assign/verify; workers execute.

- **Open the boards**: use DSH’s original right-sidebar expand button. For a
  supervisor session the right sidebar is seeded with three tabs: **start**
  (DSH’s default guide), **任务** (tasks grouped by project/status), and
  **注册** (offered workers on top, collaboration sessions not offered on the
  bottom). Other session types keep only the default start tab.
- **Registering** a worker is an **Offer** action in the 注册 tab; it writes the
  `offer` relationship and authorizes the supervisor↔worker pair.
- **Capabilities are live**: name/description are derived from the worker’s
  current title and base prompt every time a supervisor or the 注册 tab reads
  them, so changing a base prompt never leaves a stale registration snapshot.
  The tab marks a changed capability; **固定当前** pins the current text as a
  human override, and **使用实时** returns to live derivation.
- **Supervisor rule**: call `collab_capabilities` immediately before
  decomposition; it reports `source=live|override`, `version`, and
  `changed=yes|no`. Task assignment records the capability version used.
- **Task flow**: `collab_task_create` → `collab_task_assign`; the worker accepts,
  executes, and calls `collab_task_complete`; the supervisor reads
  `collab_tasks` / `collab_task_result` and may reject/retry/cancel. Capacity is
  one active task per worker.
- **Communication is role-agnostic**: `collab_send`, `collab_inbox`, and
  `collab_peers` use bilateral authorization for ordinary peers, workers, and
  supervisors alike. Chat never creates or changes tasks; only task tools do.
- **Task isolation**: a worker may chat with ordinary peers, but ordinary peers
  cannot assign work directly; they submit a request to the supervisor. Task
  results still route to the task’s supervisor.
- **Shared delivery**: workers write final artifacts directly to
  `shared/<projectId>/artifacts/`; the worker can write while the project is
  open, and read after close. A project is bound to exactly one accepted
  request. The requester can read the project artifacts only after a successful
  delivery, and cannot write. The supervisor lists them with
  `collab_delivery_list`, generates `manifest.json` with
  `collab_delivery_manifest` (path, bytes, sha256, mode), and sends the
  sanitized manifest with `collab_request_deliver` only after the project is
  closed and every task is done or cancelled. Empty deliveries are refused.
  The notice's `root` is an opaque `.deliveries/<deliveryId>/artifacts` alias,
  not the project path, so the requester does not receive a project id. The
  auth API client bundle is minified but remains self-contained (`zod` is
  bundled) for compatibility with module-loader configurations that do not
  expose `zod` as an external module.
- **No copy-out**: do not create a copy project or copy artifacts to an
  ad-hoc shared directory. The canonical `deliveryDir` is returned by the task
  assignment; ad-hoc shared writes are denied by the guard.
- **Message hygiene**: opened inbox messages are recorded in a per-session
  replay ledger; a duplicate MAC-valid message id is quarantined. First-contact
  credential creation is serialized by a pair lock. Undelivered notices older
  than seven days and unreferenced delivery aliases older than seven days are
  pruned at startup/flush.
- **Notice outbox**: protocol notices are persisted in `notices.json` before
  delivery and retried by the Host, so a temporary offline peer or revoked
  authorization does not lose a committed acceptance, assignment, or result
  wake-up.
- **Cross-process state locks**: registry, authorization, relationship, task,
  request, and notice mutations use a short-lived lock and re-read the state
  document under that lock; JSON writes are fsynced and atomically renamed.
  The default wait is bounded to 1 second (`lockTimeoutMs`), after which the
  error names the holder pid instead of blocking the Host event loop for five
  seconds; `lockStaleMs` controls when an abandoned lock can be reclaimed.
  Parsed state caches invalidate on file identity changes, and a malformed
  state document is moved to a `.corrupt-<timestamp>` backup instead of being
  silently replaced by an empty store.
- **Per-session OS sandbox**: `perSessionSandbox` (default true on macOS/Linux,
  forced off on Windows) narrows the DSH sandbox workspace boundary to each
  collab session's own workdir and registers its project delivery dirs as
  writable roots. The original workspace remains the prompt/registry value.
  Windows keeps the original workspace root and relies on the guard.
- **Managed-worker write scope**: `write`, `edit`, `apply_patch`, and ordinary
  shell write targets are limited to the assigned deliveryDir, `private/`, and
  `comm/`. The shell extractor covers bash redirections/copy verbs and common
  PowerShell cmdlets (`Set-Content`, `Add-Content`, `Out-File`, `New-Item`,
  `Copy-Item`, `Move-Item`, `Remove-Item`, `Invoke-WebRequest -OutFile`,
  `[IO.File]::WriteAllText`, and similar). It is conservative, not a complete
  PowerShell parser, and it is not an OS sandbox.
- **Requests do not require offer**: any collaboration session with bilateral
  authorization to a supervisor can call `collab_request_submit`; it does not
  need to be an offered worker. The request is a normal structured message and
  has no fixed requester role. The requirement is outcome-focused: requester
  text must not choose workers, projects, tasks, delivery paths, or internal
  scheduling.
- **Supervisor accept**: evaluate `collab_capabilities`, create a project and
  tasks, assign at least one task to an offered worker, then call
  `collab_request_accept` with the `projectId`. The request becomes `accepted`;
  the requester is notified.
- **Supervisor reject**: call `collab_request_reject` with a concrete reason,
  naming the missing capability. The request becomes `rejected`.
- **Request acknowledgement timeout**: a pending request expires after
  `requestTimeoutMs` (default 10 minutes). The requester receives a
  `request-expired` notice; an expired request cannot be accepted or rejected
  and the requester may submit a new one. The timeout covers supervisor
  acknowledgement only, not task execution.
- **Execution deadline**: an accepted request gets a soft
  `executionTimeoutMs` deadline (default 24 hours). When it passes, the request
  becomes `overdue` and the requester receives a `request-overdue` notice; work
  is not automatically killed. The supervisor can call
  `collab_request_heartbeat` with progress and an optional deadline extension;
  the requester can cancel a pending or accepted request. Successful delivery
  clears the deadline and moves the request to the terminal `delivered` state.
- **Request tools**: `collab_request_submit`, `collab_request_cancel`,
  `collab_requests`, `collab_request_accept`, `collab_request_reject`.
  Requests are stored in `requests.json` next to the other collaboration state.
- **The task tab** shows the supervisor's work requests above project groups,
  including pending/accepted/rejected status and rejection reasons.

## Supervisor panel

Supervisor sessions expose their task/capability tabs when the right sidebar is
opened. The plugin does not force the sidebar open or steal the active tab; it
seeds **start**, **任务**, and **注册** once on each collapse-to-expand
transition. Board, base-prompt, and link actions use the authorization Remote
(`collabAuth.panel`) rather than slash-command execution, so reading the board
does not add command rows to the conversation. The authorization Remote is a
required client dependency because Cordis resolves `ctx.remote.collabAuth`
through the injected service namespace. Management Remote calls are owner-only;
a non-owner Peer is rejected before it can list or mutate authorization pairs or
the collaboration board. The packaged Host service is the generated
resource-aware class (`lib/index.js`): `authorize`, `revoke`, and `panel`
declare the `session` resource, while `list` remains a global owner-only read.
The owner check is kept as the current policy, so resource metadata cannot
silently broaden access.

## Copy session name

Every named session row has a copy action in its hover strip, and the session
right-click menu has **复制会话名 / Copy session name**. The action copies the
display name to the clipboard and briefly marks the button as copied.

## Manual state recovery

State is under the DSH home:

```text
~/.dsh/collab/
  registry.json          collaboration session index
  authorization.json     bilateral communication grants
  relationships.json     supervisor↔worker offers and capability overrides
  tasks.json             projects and tasks
  requests.json          requester↔supervisor requests and deliveries
  notices.json           durable protocol notice outbox
```

A malformed document is moved aside as:

```text
<file>.corrupt-<timestamp>
```

That backup is the **bad** file, not a clean backup. Do not restore it blindly.

### Repair SOP

1. **Locate the file.** The error names the exact path:

   ```text
   collaboration state is corrupted: /home/me/.dsh/collab/tasks.json;
   backup: /home/me/.dsh/collab/tasks.json.corrupt-1760000000000
   ```

2. **Quit DSH completely.** Do not edit state while the Host is running.

3. **Back up the whole state directory.**

   ```sh
   stamp=$(date +%Y%m%d-%H%M%S)
   cp -R ~/.dsh/collab ~/.dsh/collab.manual-backup-$stamp
   ```

4. **Validate every document** (read-only):

   ```sh
   for name in registry authorization relationships tasks requests notices; do
     printf '%s: ' "$name"
     if python3 -m json.tool "$HOME/.dsh/collab/$name.json" >/dev/null 2>&1; then
       echo OK
     else
       echo BAD
     fi
   done
   ```

5. **Choose the least destructive repair:**

   - **Syntax error only, data still present:** fix quotes, commas, braces,
     brackets, or truncation in a copy, then validate with
     `python3 -m json.tool`.
   - **Schema is broken beyond repair:** replace the file with the empty
     skeleton below. The next write recreates the store.
   - **Known-good backup exists:** restore that copy, not a `.corrupt-*` file.
   - **File is missing:** do nothing; missing means empty and is recreated on
     the next write.

6. **Preserve permissions.**

   ```sh
   chmod 700 ~/.dsh/collab
   chmod 600 ~/.dsh/collab/*.json
   ```

7. **Restart DSH** and verify the affected surface:

   | File | Verify after restart |
   |---|---|
   | `registry.json` | Collaboration sessions reappear; if not, the plugin rescans the workspace `.dsh-collab` directories. |
   | `authorization.json` | Re-authorize pairs in **Collab access** if grants are gone. |
   | `relationships.json` | Re-offer workers in the supervisor's **注册** tab. |
   | `tasks.json` | Task board shows the desired projects/tasks; delivery artifacts remain on disk. |
   | `requests.json` | Requester and supervisor can list the requests that still exist. |
   | `notices.json` | Pending wake-ups may be gone; the task/request stores remain authoritative. |

### Empty skeletons

Use these when the file is syntactically broken and you accept losing that
store's data. All are valid JSON and match the current versions.

```json
{"version":1,"sessions":{}}
```

```json
{"version":2,"grants":[]}
```

```json
{"version":1,"relationships":[]}
```

```json
{"version":1,"projects":{},"tasks":{}}
```

```json
{"version":1,"requests":{}}
```

```json
{"version":1,"notices":{}}
```

### Format examples

The examples below are intentionally complete. Replace the ids, paths,
timestamps, and hashes; keep the field names and JSON types.

#### registry.json

```json
{
  "version": 1,
  "sessions": {
    "session-11111111-1111-4111-8111-111111111111": {
      "sessionId": "session-11111111-1111-4111-8111-111111111111",
      "preset": "collab",
      "originalCwd": "/Users/me/project",
      "workdir": "/Users/me/project/.dsh-collab/sessions/session-11111111-1111-4111-8111-111111111111",
      "title": "Worker A",
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000
    }
  }
}
```

- `preset` is `collab` or `supervisor`.
- `sessionId` must be a real `session-<uuid>` id.
- This file is a derived index. Resetting it is usually safe; sessions are
  rediscovered from `<workspace>/.dsh-collab/sessions/`.

#### authorization.json

```json
{
  "version": 2,
  "grants": [
    {
      "from": "session-11111111-1111-4111-8111-111111111111",
      "to": "session-22222222-2222-4222-8222-222222222222",
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000,
      "authorizedBy": "ui"
    },
    {
      "from": "session-22222222-2222-4222-8222-222222222222",
      "to": "session-11111111-1111-4111-8111-111111111111",
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000,
      "authorizedBy": "ui"
    }
  ]
}
```

- One object is one direction. Communication requires **both** directions.
- A single direction is a pending grant and does not authorize messaging.
- Prefer re-authorizing in the UI instead of hand-writing this file.

#### relationships.json

```json
{
  "version": 1,
  "relationships": [
    {
      "supervisor": "session-11111111-1111-4111-8111-111111111111",
      "worker": "session-22222222-2222-4222-8222-222222222222",
      "capabilityOverride": null,
      "offer": true,
      "request": false,
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000,
      "createdBy": "human"
    }
  ]
}
```

- `offer: true` makes the worker eligible for assignment.
- `capabilityOverride` may be `null` or:
  ```json
  {"name":"reviewer","description":"Reviews changes","tags":["review"]}
  ```
- Prefer re-offering workers in the UI after a reset.

#### tasks.json

```json
{
  "version": 1,
  "projects": {
    "project-11111111-1111-4111-8111-111111111111": {
      "id": "project-11111111-1111-4111-8111-111111111111",
      "supervisor": "session-11111111-1111-4111-8111-111111111111",
      "title": "Delivery project",
      "status": "open",
      "requestId": null,
      "createdAt": 1760000000000,
      "closedAt": null
    }
  },
  "tasks": {
    "task-22222222-2222-4222-8222-222222222222": {
      "id": "task-22222222-2222-4222-8222-222222222222",
      "supervisor": "session-11111111-1111-4111-8111-111111111111",
      "worker": "session-22222222-2222-4222-8222-222222222222",
      "projectId": "project-11111111-1111-4111-8111-111111111111",
      "title": "Write result.txt",
      "instruction": "Write result.txt with the requested content.",
      "inputs": {},
      "acceptance": "result.txt exists and contains the requested content.",
      "status": "done",
      "attempts": 1,
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000,
      "createdTurn": null,
      "assignedTurn": null,
      "capabilityVersion": null,
      "result": {
        "summary": "Created result.txt",
        "details": "6 bytes",
        "artifacts": ["result.txt"],
        "completedAt": "2026-11-24T00:00:00.000Z"
      },
      "failure": null,
      "history": [
        {"at":"2026-11-24T00:00:00.000Z","status":"assigned","note":"attempt 1"},
        {"at":"2026-11-24T00:01:00.000Z","status":"done","note":"completed by worker"}
      ]
    }
  }
}
```

- Task/project keys must match their `id`.
- `status` is one of `created`, `assigned`, `accepted`, `running`, `done`,
  `failed`, `cancelled`.
- Keep `projectId` pointing at an existing project.
- `history[].at` is an ISO timestamp; `createdAt`/`updatedAt` are epoch
  milliseconds.
- Do not invent `result` or delivery files that do not exist.

#### requests.json

```json
{
  "version": 1,
  "requests": {
    "request-33333333-3333-4333-8333-333333333333": {
      "id": "request-33333333-3333-4333-8333-333333333333",
      "requester": "session-33333333-3333-4333-8333-333333333333",
      "supervisor": "session-11111111-1111-4111-8111-111111111111",
      "title": "Deliver result.txt",
      "requirement": "Deliver result.txt containing hello.",
      "status": "delivered",
      "reason": null,
      "projectId": "project-11111111-1111-4111-8111-111111111111",
      "taskIds": ["task-22222222-2222-4222-8222-222222222222"],
      "response": null,
      "createdTurn": null,
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000,
      "resolvedAt": 1760000000000,
      "delivery": {
        "deliveryId": "delivery-44444444-4444-4444-8444-444444444444",
        "manifestSha256": "0000000000000000000000000000000000000000000000000000000000000000",
        "deliveredAt": 1760000000000
      },
      "expiresAt": null,
      "executionDeadlineAt": null,
      "lastHeartbeatAt": null,
      "heartbeatNote": null,
      "overdue": false,
      "overdueAt": null
    }
  }
}
```

- `requester` must be a real session id and must differ from `supervisor`.
- `status` is `pending`, `accepted`, `delivered`, `rejected`, `cancelled`, or
  `expired`.
- `delivery` is `null` until delivered; a fake `manifestSha256` makes the
  request look delivered without a valid delivery. Do not fabricate it.
- If only the request record is needed, keeping `delivery: null` is safer.

#### notices.json

```json
{
  "version": 1,
  "notices": {
    "notice-55555555-5555-4555-8555-555555555555": {
      "id": "notice-55555555-5555-4555-8555-555555555555",
      "from": "session-11111111-1111-4111-8111-111111111111",
      "to": "session-22222222-2222-4222-8222-222222222222",
      "payload": {
        "type": "collab-task/assign",
        "version": 1,
        "taskId": "task-22222222-2222-4222-8222-222222222222"
      },
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000,
      "attempts": 0,
      "lastError": null
    }
  }
}
```

- `payload` is an opaque protocol object; preserve existing payloads rather
  than inventing them.
- Notices are a wake-up outbox, not the source of truth. Deleting this file is
  the least destructive reset; the next write recreates it.

### Important

- Do not put `~/.dsh/collab` on a cloud-synced or network filesystem.
- Do not run two DSH Hosts against one profile.
- Do not edit these files while DSH is running.
- Per-session `session.json`, `comm/` credentials, and delivery files are
  separate from these six state documents.
- If JSON is valid but the schema is wrong, the plugin does not create a
  `.corrupt-*` backup; repair or reset it using the same SOP.

## Real browser smoke test

The client unit tests render with a React stub. An opt-in CDP test launches
headless Chrome against the running DSH Web app, authenticates with the local
browser-session credential, and checks the collab sidebar entry, new-session
menu, and authorization Remote page:

```sh
DSH_BROWSER_TEST=1 npm run test:browser
```

Requirements:

- a running DSH Web server (`DSH_WEB_URL` is exported by DSH);
- Chrome/Chromium, or `DSH_CHROME_PATH` pointing at it;
- a readable local profile (`DSH_HOME`, default `~/.dsh`) so the test can mint
  the browser-session cookie;
- `--no-sandbox` is used only for this local headless test.

Without these, the test skips instead of failing. An existing supervisor can
also be checked when its sidebar title is visible:

```sh
DSH_BROWSER_TEST=1 \
DSH_BROWSER_SUPERVISOR_TITLE='my supervisor' \
npm run test:browser
```

The optional scenario opens that session, expands the right sidebar once, and
asserts that the tasks and registration tabs are seeded.

## Usage

1. Open the Workspace you want the collab session in.
2. Click **New collab session** / **新建协作会话** directly below the sidebar's
   New session button (the same rounded 38px shape; icon-only in the collapsed
   rail).
3. The new Session opens in that Workspace; its working directory is the
   per-session `.dsh-collab` directory above.
4. Authorize the two collaboration sessions in **Collab access** (both sides).
5. In a second collab session, call `collab_peers` to discover the first
   session id, then `collab_send` with `target=<that id>`. The receiver is
   resumed/woken; its page activates; its prompt asks it to read the queued
   message with `collab_inbox`, process it, and reply with `collab_send`.

## Tools

| Tool | Purpose |
|---|---|
| `collab_info` | Session id, working directories, peers, unread counts |
| `collab_peers` | Exact peer session ids, online state, credentials |
| `collab_send` | Send one authenticated message (`target`, `message`) |
| `collab_inbox` | Read and acknowledge queued messages (`peer`, `mark_read`) |

## Limitations

- Another session's whole work directory is protected, not only its `private/`
  directory, because `comm/` holds the pair credential. The guard covers the
  `bash`/`pwsh` tools (including `workdir` and command tokens), `working_directory`
  (`cd`), `read`, `read_image`, `write`, `edit`, `glob`, `grep`,
  `apply_patch`, and `office_render`/`office_convert`/`office_recalculate`,
  plus `present` file paths. Managed-worker writes are additionally checked for
  `write`, `edit`, `apply_patch`, and bash/PowerShell destination targets. Paths are resolved through symlinks before
  comparison, including shared-delivery paths. For a collaboration session,
  wildcard tokens that could expand into `.dsh-collab/sessions`, recursive
  searches, and shells whose effective directory contains another session's
  work directory are refused; ancestor checks are not skipped when a shell
  starts in an authorized delivery directory.
  Normal project sessions keep their full shell and search behavior; only their
  direct access to a collaboration work directory is denied.
- The guard is not itself an OS security sandbox. On macOS/Linux, with
  `perSessionSandbox` enabled and a DSH `sandboxPolicy` provider, the OS
  boundary is narrowed to the session workdir plus open delivery roots; on
  Windows this per-session narrowing is disabled and the guard is the
  boundary. Another OS user is kept out by `0700` mode, but the same OS user
  running another session is blocked only by the guard on Windows: a
  deliberately obfuscated PowerShell script, a hard link to a protected file, a
  future file-reading tool the guard does not know, or the human GUI's file
  browser is outside that boundary.
- Messaging is local to this Harness profile. Nothing is sent over the network.
  The pair credential is a shared secret, so either side of a pair can produce
  a valid MAC for that pair; the file guard prevents a third session from
  reading it. The authorization check is a separate human-controlled gate of
  directional grants, stored in `authorization.json` next to the session
  registry; a pair works only when both directions are present.
- Existing pairs are not authorized automatically after this feature is added;
  authorize them in **Collab access** before messaging.
- A **disabled** bundle removes the preset. A stored session whose recorded
  preset is `collab` cannot resume until the bundle is re-enabled. Session
  directories remain on disk.
- The `collab` preset is a copy of the shipped `standard` preset because DSH
  has no preset inheritance. When a DSH upgrade changes `standard`, update
  `cordis.patch.yml` from the installed `dsh-web-app/presets/standard.patch.yml`.
- The plugin accepts an optional `registryPath` in its row config but does not
  declare a `Config` schema.
