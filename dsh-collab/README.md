# Collab sessions

A DeepSeek Harness plugin that adds a **Collab** entry to the left sidebar's
New-session row. Activating it starts a New Session under the bundled `collab`
Agent preset **in the currently selected Workspace** (the same target the
built-in New Session button uses: the current Session's Workspace, then the
recent Workspace). It does not create a new Workspace per session.

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
`lib/client.js`. The profile links `@local/dsh-collab-auth-api` as a bundle;
after rebuilding, disable/enable that bundle (or restart DSH) and refresh the
Web client so the generated `remote.collabAuth` namespace remounts. The task
board still uses the older command bridge for now; the authorization page is
the first migrated surface.

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
  Parsed state caches invalidate on file identity changes, and a malformed
  state document is moved to a `.corrupt-<timestamp>` backup instead of being
  silently replaced by an empty store.
- **Managed-worker write scope**: `write`, `edit`, `apply_patch`, and ordinary
  shell write targets are limited to the assigned deliveryDir, `private/`, and
  `comm/`. Shell target extraction is conservative; it is not an OS sandbox.
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

Supervisor sessions expose their task/capability tabs through the header **任务 /
Tasks** action. Opening a supervisor no longer expands the right sidebar or
steals the active tab, and a running session is not auto-opened unless the user
chooses it. Board, base-prompt, and link actions use the authorization Remote
(`collabAuth.panel`) rather than slash-command execution, so reading the board
does not add command rows to the conversation. The authorization Remote is a required
client dependency because Cordis resolves `ctx.remote.collabAuth` through the
injected service namespace. Management Remote calls are owner-only; a non-owner
Peer is rejected before it can list or mutate authorization pairs or the
collaboration board.

## Copy session name

Every named session row has a copy action in its hover strip, and the session
right-click menu has **复制会话名 / Copy session name**. The action copies the
display name to the clipboard and briefly marks the button as copied.

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
  `bash` tool (including `workdir` and command tokens), `working_directory`
  (`cd`), `read`, `read_image`, `write`, `edit`, `glob`, `grep`,
  `apply_patch`, and `office_render`/`office_convert`/`office_recalculate`,
  plus `present` file paths. Managed-worker writes are additionally checked for
  `write`, `edit`, `apply_patch`, and bash destination/redirection targets. Paths are resolved through symlinks before
  comparison, including shared-delivery paths. For a collaboration session,
  wildcard tokens that could expand into `.dsh-collab/sessions`, recursive
  searches, and shells whose effective directory contains another session's
  work directory are refused; ancestor checks are not skipped when a shell
  starts in an authorized delivery directory.
  Normal project sessions keep their full shell and search behavior; only their
  direct access to a collaboration work directory is denied.
- This is a session-level guard, not an OS security sandbox. Another OS user is
  kept out by the `0700` mode, but the same OS user running another session is
  blocked only by the guard: a deliberately obfuscated shell script, a hard
  link to a protected file, a future file-reading tool the guard does not know,
  or the human GUI's file browser is outside that boundary.
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
