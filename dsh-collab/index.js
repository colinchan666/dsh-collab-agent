/**
 * Host half of the collaboration-session plugin.
 *
 * The left sidebar entry creates a Session whose Agent preset is `collab`.
 * For every such Agent this plugin prepares a per-session working directory
 * (`comm/` + `private/`), registers model-facing collaboration tools scoped to
 * that Agent, adds a prompt section describing the layout, and enforces the
 * foreign-work-directory boundary for file and shell tools.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { AuthorizationStore, authorizationPathFor } from './lib/auth.js'
import { NoticeStore } from './lib/notices.js'
import { RelationshipStore } from './lib/relationships.js'
import { applyPatchTargets, shellWriteTargets } from './lib/write-scope.js'
import { RequestStore } from './lib/requests.js'
import { TaskStore } from './lib/tasks.js'
import {
  SUBDIR, SessionRegistry, credentialPath, defaultRegistryPath, discoverSiblingWorkdirs,
  ensureSessionLayout, findForeignAncestorAccess, findForeignSessionAccess,
  findForeignSessionAccessInCommand, findSuspiciousSearchPattern, inboxCount,
  canonicalPath, configureFileLocks, isDirectory, isSessionId, listInbox, markRead, migrateSessionArchive, mkdirp, readJson, sendMessage, writeJson,
} from './lib/layout.js'
import { COLLAB_PRESET as PRESET, SUPERVISOR_PRESET as SUPERVISOR, COLLAB_PRESETS } from './lib/presets.js'
import { subtaskAliases } from './lib/task-aliases.js'
import { createDeliveryManifestService } from './lib/delivery-manifest.js'
import { AuditLog } from './lib/audit.js'
import { cancelBoundTask } from './lib/cancel-request.js'
import { createPanelApi } from './lib/panel-api.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'dsh-collab-sessions'

/** Services required for session discovery, tools, prompts, and the working directory. */
export const inject = ['tools', 'agents', 'systemPrompt', 'workingDirectory', 'commands']

const MAX_MESSAGE_BYTES = 64 * 1024

/** Upper bound for one session's configured base prompt. */
const MAX_BASE_PROMPT = 16 * 1024

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render(_args, value) {
    return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
  },
}

const NO_PARAMETERS = { type: 'object', properties: {} }

const SEND_PARAMETERS = {
  type: 'object',
  properties: {
    target: { type: 'string', description: 'Exact target session id (session-...). Use collab_peers to find it.' },
    message: { type: 'string', description: 'Message text for the target session.' },
  },
  required: ['target', 'message'],
  additionalProperties: false,
}

const INBOX_PARAMETERS = {
  type: 'object',
  properties: {
    peer: { type: 'string', description: 'Optional peer session id to read only that pair.' },
    mark_read: { type: 'boolean', description: 'Whether to move read messages into the pair read directory. Defaults to true.' },
  },
  additionalProperties: false,
}

const TASK_OPEN_PARAMETERS = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short parent-task title.' },
  },
  required: ['title'],
  additionalProperties: false,
}

const TASK_CREATE_PARAMETERS = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short task title.' },
    instruction: { type: 'string', description: 'Self-contained instructions for the worker.' },
    acceptance: { type: 'string', description: 'Acceptance criteria the supervisor will verify.' },
    inputs: { type: 'object', description: 'Optional structured inputs for the worker.' },
    taskId: { type: 'string', description: 'Optional parent task id; omitted creates the task for this requirement.' },
  },
  required: ['title', 'instruction'],
  additionalProperties: false,
}

const TASK_ASSIGN_PARAMETERS = {
  type: 'object',
  properties: {
    subtaskId: { type: 'string', description: 'Subtask id (subtask-...); taskId is accepted for legacy callers.' },
    taskId: { type: 'string', description: 'Legacy subtask id alias.' },
    worker: { type: 'string', description: 'Worker session id with an offer relationship.' },
  },
  required: ['worker'],
  additionalProperties: false,
}

const TASK_ID_PARAMETERS = {
  type: 'object',
  properties: {
    taskId: { type: 'string', description: 'Task id (task-...).' },
  },
  required: ['taskId'],
  additionalProperties: false,
}

const TASK_LIST_PARAMETERS = {
  type: 'object',
  properties: {
    status: { type: 'string', description: 'Optional status filter.' },
  },
  additionalProperties: false,
}

const TASK_REJECT_PARAMETERS = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
    reason: { type: 'string', description: 'Why the delivered result is rejected.' },
  },
  required: ['taskId', 'reason'],
  additionalProperties: false,
}

const TASK_PROGRESS_PARAMETERS = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['taskId', 'note'],
  additionalProperties: false,
}

const TASK_COMPLETE_PARAMETERS = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
    summary: { type: 'string', description: 'Concise result summary.' },
    details: { type: 'string', description: 'Optional longer result details.' },
    artifacts: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional paths under the delivery subdirectory.',
    },
  },
  required: ['taskId', 'summary'],
  additionalProperties: false,
}

const TASK_FAIL_PARAMETERS = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['taskId', 'reason'],
  additionalProperties: false,
}

const TASK_CLOSE_PARAMETERS = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
  },
  required: ['taskId'],
  additionalProperties: false,
}

const DELIVERY_LIST_PARAMETERS = {
  type: 'object',
  properties: {
    taskId: { type: 'string', description: 'Optional task id; omitted lists only this supervisor\'s tasks.' },
  },
  additionalProperties: false,
}

const DELIVERY_MANIFEST_PARAMETERS = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
  },
  required: ['taskId'],
  additionalProperties: false,
}

const REQUEST_DELIVER_PARAMETERS = {
  type: 'object',
  properties: {
    requestId: { type: 'string' },
  },
  required: ['requestId'],
  additionalProperties: false,
}


const REQUEST_SUBMIT_PARAMETERS = {
  type: 'object',
  properties: {
    supervisor: { type: 'string', description: 'Target supervisor id. Required when more than one authorized supervisor is available.' },
    title: { type: 'string', description: 'Short request title.' },
    requirement: { type: 'string', description: 'Outcome-focused requirement and acceptance criteria. Do not name workers, projects, tasks, delivery paths, or internal scheduling.' },
  },
  required: ['title', 'requirement'],
  additionalProperties: false,
}

const REQUEST_LIST_PARAMETERS = {
  type: 'object',
  properties: {
    status: { type: 'string', description: 'Optional status filter.' },
  },
  additionalProperties: false,
}

const REQUEST_ACCEPT_PARAMETERS = {
  type: 'object',
  properties: {
    requestId: { type: 'string' },
    taskId: { type: 'string', description: 'Task containing the subtasks created for this request.' },
    response: { type: 'string', description: 'Optional message for the requester.' },
  },
  required: ['requestId', 'taskId'],
  additionalProperties: false,
}

const REQUEST_REJECT_PARAMETERS = {
  type: 'object',
  properties: {
    requestId: { type: 'string' },
    reason: { type: 'string', description: 'Why the registered capabilities cannot satisfy this request; name the missing capability.' },
  },
  required: ['requestId', 'reason'],
  additionalProperties: false,
}

const REQUEST_CANCEL_PARAMETERS = {
  type: 'object',
  properties: {
    requestId: { type: 'string' },
  },
  required: ['requestId'],
  additionalProperties: false,
}

const REQUEST_HEARTBEAT_PARAMETERS = {
  type: 'object',
  properties: {
    requestId: { type: 'string' },
    note: { type: 'string', description: 'Optional progress note for the requester.' },
    extendByMs: { type: 'number', description: 'Optional execution deadline extension in milliseconds, capped at seven days.' },
  },
  required: ['requestId'],
  additionalProperties: false,
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}

function iso(time) {
  return typeof time === 'number' && Number.isFinite(time) ? new Date(time).toISOString() : 'unknown'
}

/** Prompt text visible only inside a collaboration session. */
function promptText(sessionId, layout, role, relationships, capabilityLines = []) {
  const basePrompt = typeof layout.meta.basePrompt === 'string' ? layout.meta.basePrompt.trim() : ''
  const baseSection = basePrompt.length === 0
    ? []
    : ['Session base prompt (role and constraints for this session; apply it to every turn):', basePrompt, '']
  const header = [
    ...baseSection,
    `This is ${role === 'supervisor' ? 'supervisor' : 'collaboration'} session ${sessionId}.`,
    `Its working directory is ${layout.workdir}; it contains exactly two collaboration directories:`,
    `- comm/<peerSessionId>/ holds credential.json plus inbox/ (unread inbound), outbox/ (sent), archive/inbox/ (read inbound), and archive/outbox/ (explicitly archived sent).`,
    `- private/ belongs only to this session; it is mode 0700.`,
    `Never read, write, search, or infer another session's working directory (comm or private): the tool guard denies it.`,
    `Recursive searches and shells rooted above another session's working directory are also refused; use the task tools instead.`,
    `Workspace: ${layout.meta.originalCwd}.`,
    '',
  ]
  if (role === 'supervisor') {
    return [
      ...header,
      ...(capabilityLines.length === 0 ? [] : [
        'Current registered capabilities (live; re-check before decomposition):',
        ...capabilityLines,
        '',
      ]),
      'You are the SUPERVISOR. You do not implement anything yourself.',
      'You only decompose requirements, assign tasks to registered functional sessions, verify results, retry/reject, and deliver.',
      'You have no shell, file, office, web, or edit tools. Never try to perform a task yourself.',
      '',
      'Coordination tools:',
      '- collab_inbox reads messages from any authorized peer, including task/request notifications. Call it at the start of every turn.',
      '- collab_peers / collab_send are ordinary communication tools for authorized peers. Chat does not create or change tasks.',
      '- collab_requests lists work requests. For each pending request, evaluate registered capabilities before accepting or rejecting.',
      '- collab_capabilities lists the functional sessions registered to you, their capabilities, online/authorization state, and workload.',
      '- collab_task_open creates the parent task for one requirement.',
      '- collab_task_list lists parent tasks.',
      '- collab_subtask_create creates a subtask under that parent task.',
      '- collab_subtask_assign assigns a subtask to an offered worker.',
      '- collab_subtasks lists subtasks for the supervisor or worker.',
      '- collab_task_create creates a subtask under that task.',
      '- collab_task_assign assigns a task to a worker with an offer relationship and wakes it.',
      '- collab_tasks / collab_task_result inspect progress and results.',
      '- collab_task_retry / collab_task_reject / collab_task_cancel manage failures and revisions.',
      '- collab_task_close closes a task after all its subtasks finish.',
      '- collab_delivery_list lists the canonical shared delivery files (names/sizes/times).',
      '- collab_delivery_manifest writes a task manifest with path, bytes, sha256, and mode.',
      '- collab_request_deliver sends the sanitized manifest to an accepted requester.',
      '',
      'How to work:',
      '0. At the start of every turn, read collab_requests. For each pending request, evaluate the registered capabilities. If the request is feasible, create a task and subtasks, assign at least one subtask to an offered worker, then call collab_request_accept with the taskId. If it is not feasible, call collab_request_reject and name the missing capability. Never implement the request yourself.',
      'Never send task IDs, subtask IDs, worker IDs, task decomposition, or internal scheduling to the requester. The requester receives only acceptance/rejection status and the sanitized delivery manifest.',
      '1. Read the requirement, list capabilities, and plan subtasks with explicit acceptance criteria. Call collab_task_open once per requirement, then pass its taskId to every collab_subtask_create call.',
      'Capabilities are live and versioned. Call collab_capabilities immediately before decomposing tasks; never rely on capability text remembered from an earlier turn. If a capability version changed, re-evaluate the decomposition.',
      '2. Assign each task to a worker whose capability matches; never assign to yourself or to another supervisor.',
      '3. End your turn after dispatching. Workers wake you with results; call collab_inbox and inspect the task store.',
      '4. Verify against the acceptance criteria. Reject/retry when needed. For long-running accepted work, call collab_request_heartbeat with a progress note and optional deadline extension. Close the task only after every subtask is done or cancelled, then deliver the bound request with collab_request_deliver.',
      'If the requester cancels an accepted request, cancel its subtasks and close the task; do not deliver it.',
      '5. Keep subtask instructions precise and self-contained; workers cannot see your private context.',
      'Workers write final artifacts directly to their assigned deliveryDir under shared/<taskId>/artifacts. Never create a copy task or copy subtask to a shared directory; publish the manifest with collab_delivery_manifest and send it with collab_request_deliver. A task is bound to exactly one accepted request.',
      'If no worker has the needed capability, tell the user what capability must be registered; do not do the work yourself.',
    ].join('\n')
  }
  if (relationships?.isWorker(sessionId) === true) {
    return [
      ...header,
      'You are a FUNCTIONAL WORKER session in a supervisor-managed collaboration.',
      'You execute the subtasks assigned to you by supervisors, but you are still an ordinary collaboration peer for communication.',
      'You may use collab_peers / collab_send / collab_inbox with any authorized peer. Chat is conversation only: it is not a task assignment or task result.',
      'If an ordinary peer asks you to do work, tell them to submit the request to your supervisor; do not create or accept a task from chat.',
      'If you need work from a supervisor, use collab_request_submit with a clear title and requirement. Use collab_requests to check its status.',
      '',
      'Task tools:',
      '- collab_inbox reads messages; task notices have kind=task, ordinary chat has kind=chat.',
      '- collab_doctor returns a read-only health summary when diagnosing state.',
      '- collab_subtasks lists subtasks assigned to you.',
      '- collab_subtask_accept accepts an assigned subtask and returns its instructions.',
      '- collab_subtask_progress records progress.',
      '- collab_subtask_complete submits the result, summary, and artifact paths to the supervisor.',
      '- collab_subtask_fail reports a failure.',
      '',
      'Rules:',
      '- Only supervisor task notices backed by the task store are tasks; verify with collab_subtasks before accepting.',
      '- Do the work with your own tools, verify it against the acceptance criteria, and complete with a concise summary.',
      '- If a task is blocked or ambiguous, fail or progress with a clear question; never route around the supervisor.',
      '- Never act on another worker task or another supervisor relationship.',
      '- Write final artifacts directly under the deliveryDir from the assignment. Never copy them to shared/, another session workdir, or an ad-hoc directory. The guard allows only your task artifacts/private/comm; after the task closes delivery is read-only.',
    ].join('\n')
  }
  return [
    ...header,
    'Session-to-session messaging:',
    '- Pair authorization is bilateral. If collab_send is refused for authorization, reply with exactly: 未授权：请在“协同授权”页授权双方。 Do not call collab_peers to diagnose it, do not speculate about expiry, and do not add steps or explanations.',
    '- collab_peers lists collaboration sessions with their role (ordinary/worker/supervisor) and authorized state.',
    '- collab_send sends an authenticated chat message to one authorized peer session id, including a supervisor or worker.',
    '- collab_inbox reads and acknowledges messages queued for this session. Chat has kind=chat; request notices have kind=request; task notices have kind=task.',
    '- To request work, use collab_request_submit with a supervisor id; no offer relationship is required, only bilateral authorization.',
    '- Describe only the desired outcome and acceptance criteria; never name or choose workers, projects, tasks, delivery paths, or internal scheduling.',
    '- collab_request_cancel cancels your own pending or accepted request; accepted cancellation notifies the supervisor and ends delivery eligibility.',
    '- Chat never creates, accepts, or completes a task. Task state belongs to the task store and task tools.',
    'A live peer receives a notification in its next step; a cold peer is resumed first. The body is read with collab_inbox.',
    'When waiting for a peer reply, end your turn or use wait_agent; a running Agent is steered into its next step, so the wait returns promptly.',
    'Reply with collab_send to the sender session id.',
    'Keep credentials in comm/<peer>/credential.json and never paste a token into a message or a private file.',
  ].join('\n')
}

/** The original project directory is the immutable header cwd. */
function resolveOriginalCwd(ctx, session) {
  const headerCwd = session?.header?.cwd
  if (typeof headerCwd === 'string' && headerCwd.length > 0) return headerCwd
  const current = ctx.workingDirectory.get(session)
  const suffix = `${path.sep}${path.join(SUBDIR, 'sessions', session.id)}`
  const resolved = path.resolve(current)
  if (resolved.endsWith(suffix)) return resolved.slice(0, -suffix.length) || path.sep
  return current
}

function wakeText(message) {
  return [
    `[collab] A message from collaboration session ${message.from} is queued (message id ${message.id}).`,
    'Call collab_inbox to read and acknowledge it. Reply with collab_send target "' + message.from + '".',
  ].join('\n')
}

function makeWakeMessage(message) {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: wakeText(message) }],
    source: { kind: 'collab-session', fromSessionId: message.from, messageId: message.id },
  }
}

/** Register the plugin. */
export function apply(ctx, config = {}) {
  configureFileLocks({
    timeoutMs: config.lockTimeoutMs,
    staleMs: config.lockStaleMs,
  })
  const dshHomePath = ctx.get('dshHomePath')
  const registryPath = typeof config.registryPath === 'string' && config.registryPath.length > 0
    ? config.registryPath
    : (typeof dshHomePath === 'function' ? dshHomePath('collab', 'registry.json') : defaultRegistryPath())
  const sharedRoot = typeof config.sharedRoot === 'string' && config.sharedRoot.length > 0
    ? path.resolve(config.sharedRoot)
    : path.join(path.dirname(registryPath), 'shared')
  const requestTimeoutMs = Number.isFinite(Number(config.requestTimeoutMs))
    ? Math.max(100, Number(config.requestTimeoutMs))
    : 10 * 60 * 1000
  const executionTimeoutMs = Number.isFinite(Number(config.executionTimeoutMs))
    ? Math.max(100, Number(config.executionTimeoutMs))
    : 24 * 60 * 60 * 1000
  const perSessionSandbox = config.perSessionSandbox !== false && process.platform !== 'win32'
  const registry = new SessionRegistry(registryPath)
  const audit = new AuditLog(path.join(path.dirname(registryPath), 'audit.jsonl'))
  const auth = new AuthorizationStore(
    typeof config.authorizationPath === 'string' && config.authorizationPath.length > 0
      ? config.authorizationPath
      : authorizationPathFor(registryPath),
  )
  const relationships = new RelationshipStore(
    typeof config.relationshipsPath === 'string' && config.relationshipsPath.length > 0
      ? config.relationshipsPath
      : path.join(path.dirname(registryPath), 'relationships.json'),
  )
  const tasks = new TaskStore(
    typeof config.tasksPath === 'string' && config.tasksPath.length > 0
      ? config.tasksPath
      : path.join(path.dirname(registryPath), 'tasks.json'),
  )
  const requests = new RequestStore(
    typeof config.requestsPath === 'string' && config.requestsPath.length > 0
      ? config.requestsPath
      : path.join(path.dirname(registryPath), 'requests.json'),
  )
  const notices = new NoticeStore(
    typeof config.noticesPath === 'string' && config.noticesPath.length > 0
      ? config.noticesPath
      : path.join(path.dirname(registryPath), 'notices.json'),
  )
  const requestTimers = new Map()
  const executionTimers = new Map()
  const sandboxDeliveryRoots = new Map()
  const sandboxReadRoots = new Map()
  const deliveryInFlight = new Set()
  let noticeFlushInFlight = false
  /** Human-facing authorization operations shared by the UI Remote and commands. */
  const isKnownCollab = (id) => collabSessions.has(id)
    || registry.get(id)?.preset === PRESET
    || registry.get(id)?.preset === SUPERVISOR
  const collabAdmin = {
    isKnownCollab,
    audit: (limit = 100) => audit.tail(limit),
    listAuth: () => ({
      pairs: auth.listPairs().filter(pair => isKnownCollab(pair.a) && isKnownCollab(pair.b)),
      pending: auth.listPending().filter(grant => isKnownCollab(grant.from) && isKnownCollab(grant.to)),
    }),
    authorize: (a, b) => {
      if (!isKnownCollab(a) || !isKnownCollab(b)) throw new Error('authorization requires two known collaboration sessions')
      auth.authorize(a, b, 'ui')
      audit.append('authorization.authorize', { a, b })
      return collabAdmin.listAuth()
    },
    revoke: (a, b) => {
      auth.revoke(a, b)
      audit.append('authorization.revoke', { a, b })
      return collabAdmin.listAuth()
    },
  }
  ctx.effect(() => {
    const dispose = ctx.provide('collabAdmin', collabAdmin)
    return () => { dispose() }
  }, 'collab:admin-service')
  /** Turn number of the current tool call, used to locate tasks in the chat. */
  const callTurns = new Map()
  /** Preset chosen for each collaboration session (collab or supervisor). */
  const sessionPresets = new Map()
  /** Session ids whose layout is ready and whose prompt section is installed. */
  const collabSessions = new Set()
  /** Per-agent prompt fibers, disposed with the agent or with this plugin. */
  const promptFibers = new Map()

  const warn = (message) => {
    try { ctx.logger.warn(`[collab] ${message}`) } catch { console.warn(`[collab] ${message}`) }
  }

  const workspacePaths = () => {
    const workspaces = ctx.get('workspaceRegistry')
    if (workspaces === undefined) return []
    try {
      return workspaces.list().map(workspace => workspace.path)
    } catch {
      return []
    }
  }

  const refreshRegistry = () => {
    try { registry.scanWorkspaces(workspacePaths()) } catch (error) { warn(`registry scan failed: ${describeError(error)}`) }
  }

  const disposePrompt = (sessionId) => {
    const entry = promptFibers.get(sessionId)
    if (entry === undefined) return
    promptFibers.delete(sessionId)
    try {
      const disposing = entry.fiber.dispose()
      if (disposing !== undefined && typeof disposing.catch === 'function') {
        void disposing.catch((error) => { warn(`prompt cleanup failed: ${describeError(error)}`) })
      }
    } catch (error) {
      warn(`prompt cleanup failed: ${describeError(error)}`)
    }
  }

  const installPrompt = (agent, layout, role = PRESET) => {
    const previous = promptFibers.get(agent.id)
    if (previous !== undefined) {
      if (previous.agent === agent && previous.layout?.workdir === layout.workdir) return
      disposePrompt(agent.id)
    }
    try {
      const fiber = agent.ctx.inject(['systemPrompt'], (scope) => {
        scope.systemPrompt.section({
          name: 'collab:session',
          order: scope.systemPrompt.getSectionOrder('TOOL_SUBAGENT'),
          text: () => promptText(agent.id, layout, role, relationships, role === SUPERVISOR ? capabilityRoster(agent.id) : []),
        })
      })
      promptFibers.set(agent.id, { agent, fiber, layout, role })
    } catch (error) {
      warn(`could not install the collaboration prompt for ${agent.id}: ${describeError(error)}`)
    }
  }

  const bindDeliverySandbox = (sessionId, directory, writable = true) => {
    const resolved = path.resolve(directory)
    const reads = sandboxReadRoots.get(sessionId) ?? new Set()
    reads.add(resolved)
    sandboxReadRoots.set(sessionId, reads)
    if (writable) {
      const writes = sandboxDeliveryRoots.get(sessionId) ?? new Set()
      writes.add(resolved)
      sandboxDeliveryRoots.set(sessionId, writes)
    }
    try { mkdirp(directory, 0o755) } catch { /* the assignment will report a real mkdir failure */ }
  }

  const sharedRootVariants = () => {
    const forward = sharedRoot.replaceAll('\\', '/')
    return forward === sharedRoot ? [sharedRoot] : [sharedRoot, forward]
  }
  const commandMentionsSharedRoot = (command) => {
    const text = process.platform === 'win32' ? String(command).toLowerCase() : String(command)
    return sharedRootVariants().some(root => text.includes(process.platform === 'win32' ? root.toLowerCase() : root))
  }
  const sharedCommandAllowed = (command, sessionId) => {
    if (!isManagedWorker(sessionId)) return false
    const roots = [...(sandboxReadRoots.get(sessionId) ?? [])].map(root => canonicalPath(root))
    if (roots.length === 0) return false
    const text = String(command)
    const haystack = process.platform === 'win32' ? text.toLowerCase() : text
    const comparable = (value) => process.platform === 'win32' ? value.toLowerCase() : value
    for (const root of sharedRootVariants()) {
      const needle = process.platform === 'win32' ? root.toLowerCase() : root
      let cursor = 0
      while (true) {
        const index = haystack.indexOf(needle, cursor)
        if (index < 0) break
        const token = text.slice(index).split(/[\s;&|"'`]+/u)[0]
        const resolved = canonicalPath(token)
        if (!roots.some(owned => comparable(resolved) === comparable(owned) || comparable(resolved).startsWith(`${comparable(owned)}${path.sep}`))) {
          return false
        }
        cursor = index + needle.length
      }
    }
    return true
  }

  const releaseDeliverySandbox = (sessionId, directory) => {
    const roots = sandboxDeliveryRoots.get(sessionId)
    if (roots === undefined) return
    roots.delete(path.resolve(directory))
    if (roots.size === 0) sandboxDeliveryRoots.delete(sessionId)
  }

  const installSandboxWrapper = (policy) => {
    if (!perSessionSandbox) return
    if (policy === undefined || typeof policy.resolve !== 'function') return
    const original = policy.resolve.bind(policy)
    const wrapped = (request = {}) => {
      const resolved = original(request)
      const session = request?.session
      if (session === undefined || resolved.mode !== 'workspace-write') return resolved
      const entry = registry.get(session.id)
      if (entry === undefined) return resolved
      const roots = sandboxDeliveryRoots.get(session.id)
      const additional = roots === undefined
        ? resolved.additionalWritableRoots
        : [...new Set([...(resolved.additionalWritableRoots ?? []), ...roots])]
      return {
        ...resolved,
        workspaceRoot: entry.workdir,
        ...(additional === undefined || additional.length === 0 ? {} : { additionalWritableRoots: additional }),
      }
    }
    try {
      policy.resolve = wrapped
    } catch (error) {
      warn(`could not install per-session OS sandbox: ${describeError(error)}`)
      return
    }
    ctx.effect(() => () => {
      try { policy.resolve = original } catch { /* best effort */ }
    }, 'collab:per-session-sandbox')
  }

  const installPerSessionSandbox = () => {
    if (!perSessionSandbox) return
    if (typeof ctx.inject === 'function') {
      ctx.inject(['sandboxPolicy'], (scope) => {
        installSandboxWrapper(scope.sandboxPolicy)
      })
      return
    }
    installSandboxWrapper(ctx.get('sandboxPolicy'))
  }

  const setupAgent = async (agent, { force = false, preset } = {}) => {
    try {
      const session = agent.session
      if (session === undefined) return false
      if (session.header?.origin === 'subagent') return false
      // A reused blank Session records the requested preset as a durable
      // `agent-preset/selected` event, so the header is not authoritative.
      const currentPreset = ctx.get('agentPresets')?.presetForSession(session) ?? session.header?.agentPreset
      const effectivePreset = force && typeof preset === 'string' ? preset : currentPreset
      if (!COLLAB_PRESETS.has(effectivePreset)) return false
      const role = effectivePreset === SUPERVISOR ? SUPERVISOR : PRESET
      // The Session belongs to the Workspace it was created in; the plugin
      // gives it a per-session working directory inside that Workspace.
      const registeredOriginal = registry.get(agent.id)?.originalCwd
      const originalCwd = typeof registeredOriginal === 'string'
        ? registeredOriginal
        : resolveOriginalCwd(ctx, session)
      const layout = ensureSessionLayout({ originalCwd, sessionId: agent.id, preset: effectivePreset })
      try {
        registry.upsert({
          sessionId: agent.id,
          preset: effectivePreset,
          originalCwd,
          workdir: layout.workdir,
          createdAt: layout.meta.createdAt,
          updatedAt: Date.now(),
        })
      } catch (error) {
        warn(`could not update the collaboration registry: ${describeError(error)}`)
      }
      // Move once. Later resumes must not undo a user- or model-initiated `cd`.
      if (layout.meta.workingDirectorySet !== true) {
        try {
          const current = ctx.workingDirectory.get(session)
          if (path.resolve(current) !== path.resolve(layout.workdir)) {
            await ctx.workingDirectory.set(agent, layout.workdir)
          }
          layout.meta.workingDirectorySet = true
          layout.meta.updatedAt = Date.now()
          writeJson(path.join(layout.workdir, 'session.json'), layout.meta, 0o600)
        } catch (error) {
          warn(`could not move ${agent.id} into ${layout.workdir}: ${describeError(error)}`)
          return false
        }
      }
      installPrompt(agent, layout, role)
      collabSessions.add(agent.id)
      sessionPresets.set(agent.id, effectivePreset)
      for (const task of tasks.listForWorker(agent.id)) {
        const project = tasks.project(task.taskId)
        bindDeliverySandbox(agent.id, deliveryRoot(task.taskId), project?.status === 'open')
      }
      return true
    } catch (error) {
      warn(`session setup failed for ${agent?.id}: ${describeError(error)}`)
      return false
    }
  }

  const requireSelf = (exec) => {
    const sessionId = exec?.agent?.id
    if (!isSessionId(sessionId)) throw new Error('collaboration tools require a live session')
    let entry = registry.get(sessionId)
    if (entry === undefined) {
      refreshRegistry()
      entry = registry.get(sessionId)
    }
    if (entry === undefined || !collabSessions.has(sessionId)) {
      throw new Error('this session is not initialized as a collaboration session')
    }
    return entry
  }

  const isSupervisorSession = (sessionId) => sessionPresets.get(sessionId) === SUPERVISOR
  const isManagedWorker = (sessionId) => relationships.isWorker(sessionId)

  /** Communication is role-agnostic; inboxText filters by bilateral authorization. */
  const inboxPeerAllowed = () => true

  /** Deliver one task protocol message through the authenticated pair transport. */
  const deliverTaskNotice = async (self, targetId, payload) => {
    if (!auth.isAuthorized(self.sessionId, targetId)) {
      throw new Error('未授权：请在“协同授权”页授权双方。')
    }
    const peer = registry.get(targetId)
    if (peer === undefined) throw new Error(`unknown collaboration session: ${targetId}`)
    if (typeof peer.workdir !== 'string' || !isDirectory(peer.workdir)) {
      throw new Error(`target working directory is missing: ${String(peer.workdir)}`)
    }
    const message = sendMessage({
      selfId: self.sessionId,
      selfWorkdir: self.workdir,
      peerId: peer.sessionId,
      peerWorkdir: peer.workdir,
      kind: String(payload?.type ?? '').includes('request') ? 'request' : 'task',
      text: JSON.stringify(payload),
    })
    return wakePeer(peer.sessionId, message)
  }

  /** Queue before sending so a committed state change cannot lose its wake-up. */
  const sendTaskNotice = async (self, targetId, payload) => {
    const notice = notices.enqueue({ from: self.sessionId, to: targetId, payload })
    try {
      const delivery = await deliverTaskNotice(self, targetId, payload)
      notices.remove(notice.id)
      return delivery
    } catch (error) {
      notices.fail(notice.id, error)
      warn(`notice ${notice.id} queued for ${targetId}: ${describeError(error)}`)
      return `queued (${describeError(error)})`
    }
  }

  const flushNotices = async () => {
    if (noticeFlushInFlight) return
    noticeFlushInFlight = true
    try {
      notices.prune()
      for (const notice of notices.list()) {
        // Let the originating send finish first; a crash leaves it eligible
        // for the next sweep after the grace period.
        if (notice.attempts === 0 && Date.now() - notice.createdAt < 30000) continue
        const sender = registry.get(notice.from)
        if (sender === undefined || typeof sender.workdir !== 'string') continue
        try {
          await deliverTaskNotice(
            { sessionId: sender.sessionId, workdir: sender.workdir },
            notice.to,
            notice.payload,
          )
          notices.remove(notice.id)
        } catch (error) {
          notices.fail(notice.id, error)
        }
      }
    } finally {
      noticeFlushInFlight = false
    }
  }

  const MAX_DELIVERY_LIST_FILES = 2000
  const listDeliveryFiles = (root, base = root, out = []) => {
    if (out.length >= MAX_DELIVERY_LIST_FILES) { out.truncated = true; return out }
    let entries
    try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return out }
    for (const entry of entries) {
      if (out.length >= MAX_DELIVERY_LIST_FILES) { out.truncated = true; break }
      const full = path.join(root, entry.name)
      if (entry.isDirectory()) {
        listDeliveryFiles(full, base, out)
        continue
      }
      if (!entry.isFile()) continue
      let stat
      try { stat = fs.statSync(full) } catch { continue }
      out.push({
        path: path.relative(base, full),
        size: stat.size,
        modifiedAt: stat.mtimeMs,
      })
    }
    return out
  }
  const { buildDeliveryManifest, publishDeliveryAlias } = createDeliveryManifestService({
    sharedRoot,
    tasks,
    fs,
    path,
    crypto,
    mkdirp,
    writeJson,
    listDeliveryFiles,
    warn,
    maxFiles: MAX_DELIVERY_LIST_FILES,
  })
  const deliveryRoot = (taskId) => path.join(sharedRoot, taskId ?? 'default', 'artifacts')

  const peersText = (self) => {
    const entries = registry.list().filter(entry => entry.sessionId !== self.sessionId && COLLAB_PRESETS.has(entry.preset))
    if (entries.length === 0) {
      return 'No other collaboration sessions are registered yet. Create another one from the left sidebar entry.'
    }
    const lines = [`This session: ${self.sessionId}`, '']
    for (const entry of entries) {
      const online = ctx.agents.get(entry.sessionId) !== undefined
      const credential = readJson(credentialPath(self.workdir, entry.sessionId)) !== undefined
      const unread = inboxCount(self.workdir, entry.sessionId)
      const authorized = auth.isAuthorized(self.sessionId, entry.sessionId)
      const role = isSupervisorSession(entry.sessionId) ? 'supervisor' : (isManagedWorker(entry.sessionId) ? 'worker' : 'ordinary')
      const title = typeof entry.title === 'string' && entry.title.length > 0 ? `  title=${JSON.stringify(entry.title)}` : ''
      lines.push(
        `- ${entry.sessionId}  role=${role}  ${online ? 'online' : 'offline'}  authorized=${authorized ? 'yes' : 'no'}  unread=${unread}  credential=${credential ? 'yes' : 'no'}${title}`,
      )
    }
    return lines.join('\n')
  }

  const infoText = (self) => {
    const peers = registry.list().filter(entry => entry.sessionId !== self.sessionId)
    const lines = [
      `session id: ${self.sessionId}`,
      `preset: ${self.preset}`,
      `working directory: ${self.workdir} (other sessions are denied direct tool access)`,
      `communication directory: ${path.join(self.workdir, 'comm')} (pair-shared files; direct tool access from other sessions is denied)`,
      `private directory: ${path.join(self.workdir, 'private')} (session-only; mode 0700)`,
      `original workspace: ${self.originalCwd}`,
      '',
      `known peers: ${peers.length}`,
    ]
    for (const peer of peers) {
      const unread = inboxCount(self.workdir, peer.sessionId)
      const online = ctx.agents.get(peer.sessionId) !== undefined
      lines.push(`- ${peer.sessionId}  ${online ? 'online' : 'offline'}  unread=${unread}`)
    }
    return lines.join('\n')
  }

  const clearRequestTimer = (requestId) => {
    const timer = requestTimers.get(requestId)
    if (timer !== undefined) clearTimeout(timer)
    requestTimers.delete(requestId)
  }

  const sendRequestExpiredNotice = async (request) => {
    const supervisor = registry.get(request.supervisor)
    if (supervisor === undefined) return
    try {
      await sendTaskNotice(
        { sessionId: supervisor.sessionId, workdir: supervisor.workdir },
        request.requester,
        {
          type: 'collab-task/request-expired',
          version: 1,
          requestId: request.id,
          title: request.title,
          reason: request.reason,
        },
      )
    } catch (error) {
      warn(`request expiry notice failed for ${request.id}: ${describeError(error)}`)
    }
  }

  const expireRequest = async (requestId) => {
    const request = requests.get(requestId)
    if (request === undefined || request.status !== 'pending') {
      clearRequestTimer(requestId)
      return
    }
    clearRequestTimer(requestId)
    const expired = requests.expire(requestId)
    await sendRequestExpiredNotice(expired)
  }

  const scheduleRequestTimeout = (request) => {
    clearRequestTimer(request.id)
    if (request.status !== 'pending' || !Number.isFinite(request.expiresAt)) return
    const delay = Math.max(0, request.expiresAt - Date.now())
    const timer = setTimeout(() => {
      requestTimers.delete(request.id)
      void expireRequest(request.id).catch(error => {
        warn(`request timeout failed for ${request.id}: ${describeError(error)}`)
      })
    }, delay)
    timer.unref?.()
    requestTimers.set(request.id, timer)
  }

  const sweepRequestTimeouts = () => {
    const now = Date.now()
    for (const request of requests.list()) {
      if (request.status !== 'pending') {
        clearRequestTimer(request.id)
        continue
      }
      if (!Number.isFinite(request.expiresAt)) {
        const updated = requests.update(request.id, (entry) => {
          entry.expiresAt = entry.createdAt + requestTimeoutMs
        }, now)
        scheduleRequestTimeout(updated)
        continue
      }
      if (request.expiresAt <= now) {
        void expireRequest(request.id).catch(error => {
          warn(`request expiry failed for ${request.id}: ${describeError(error)}`)
        })
      } else {
        scheduleRequestTimeout(request)
      }
    }
  }

  const clearExecutionTimer = (requestId) => {
    const timer = executionTimers.get(requestId)
    if (timer !== undefined) clearTimeout(timer)
    executionTimers.delete(requestId)
  }

  const sendRequestOverdueNotice = async (request) => {
    const supervisor = registry.get(request.supervisor)
    if (supervisor === undefined) return
    try {
      await sendTaskNotice(
        { sessionId: supervisor.sessionId, workdir: supervisor.workdir },
        request.requester,
        {
          type: 'collab-task/request-overdue',
          version: 1,
          requestId: request.id,
          title: request.title,
          deadline: request.executionDeadlineAt,
        },
      )
    } catch (error) {
      warn(`request overdue notice failed for ${request.id}: ${describeError(error)}`)
    }
  }

  const markRequestOverdue = async (requestId) => {
    const request = requests.get(requestId)
    if (request === undefined || request.status !== 'accepted' || request.overdue === true) {
      clearExecutionTimer(requestId)
      return
    }
    clearExecutionTimer(requestId)
    const overdue = requests.markOverdue(requestId)
    await sendRequestOverdueNotice(overdue)
  }

  const scheduleExecutionDeadline = (request) => {
    clearExecutionTimer(request.id)
    if (request.status !== 'accepted' || request.overdue === true || !Number.isFinite(request.executionDeadlineAt)) return
    const delay = Math.max(0, request.executionDeadlineAt - Date.now())
    const timer = setTimeout(() => {
      executionTimers.delete(request.id)
      void markRequestOverdue(request.id).catch(error => {
        warn(`execution deadline failed for ${request.id}: ${describeError(error)}`)
      })
    }, delay)
    timer.unref?.()
    executionTimers.set(request.id, timer)
  }

  const sweepExecutionDeadlines = () => {
    const now = Date.now()
    for (const request of requests.list()) {
      if (request.status === 'delivered') {
        clearExecutionTimer(request.id)
        continue
      }
      if (request.status !== 'accepted') {
        clearExecutionTimer(request.id)
        continue
      }
      if (request.overdue === true) {
        clearExecutionTimer(request.id)
        continue
      }
      let deadline = request.executionDeadlineAt
      if (!Number.isFinite(deadline)) {
        const acceptedAt = Number.isFinite(request.resolvedAt) ? request.resolvedAt : request.updatedAt
        const updated = requests.update(request.id, (entry) => {
          entry.executionDeadlineAt = acceptedAt + executionTimeoutMs
        }, now)
        deadline = updated.executionDeadlineAt
      }
      if (deadline <= now) {
        void markRequestOverdue(request.id).catch(error => {
          warn(`execution deadline failed for ${request.id}: ${describeError(error)}`)
        })
      } else {
        scheduleExecutionDeadline(request)
      }
    }
  }

  const wakePeer = async (targetId, message) => {
    // Receiver gate: authorization can be revoked after the sender wrote the
    // file, so delivery re-checks the current pair.
    if (!auth.isAuthorized(message.from, targetId)) {
      return 'blocked（未授权：请在“协同授权”页授权双方）'
    }
    let target = ctx.agents.get(targetId)
    let resumed = false
    if (target === undefined) {
      try {
        const handle = await ctx.agents.resume({ resumeSessionId: targetId })
        target = handle.agent
        resumed = true
      } catch (error) {
        // A concurrent wake may have resumed it between the lookup and here.
        target = ctx.agents.get(targetId)
        if (target === undefined) {
          return `queued (target is not live and resume failed: ${describeError(error)})`
        }
      }
    }
    try {
      const wake = makeWakeMessage(message)
      // A running Agent (for example one inside wait_agent) must receive the
      // notification in its NEXT STEP; followup would queue it for the next
      // turn and leave wait_agent blocked until its timeout.
      if (target.status === 'running' && typeof target.steer === 'function') {
        target.steer(wake)
        return 'delivered live (steered into the target\'s next step; the message stays queued until collab_inbox runs)'
      }
      if (typeof target.followup === 'function') {
        target.followup(wake)
        return resumed
          ? 'delivered live (target resumed and woken; the message stays queued until collab_inbox runs)'
          : 'delivered live (target woken; the message stays queued until collab_inbox runs)'
      }
      if (typeof target.inject === 'function') {
        target.inject(wake)
        return 'delivered to the live target inbox (the message stays queued until collab_inbox runs)'
      }
      return 'queued (target agent does not accept inbox messages)'
    } catch (error) {
      return `queued (live delivery failed: ${describeError(error)})`
    }
  }

  const inboxText = (self, peer, markReadEnabled) => {
    const result = listInbox({ selfId: self.sessionId, selfWorkdir: self.workdir })
    const selected = peer === undefined ? result.messages : result.messages.filter(item => item.peerId === peer)
    const allowed = selected.filter(item => inboxPeerAllowed(self.sessionId, item.peerId))
    const authorized = allowed.filter(item => auth.isAuthorized(self.sessionId, item.peerId))
    const blocked = selected.length - authorized.length
    if (markReadEnabled) {
      for (const item of authorized) {
        try { markRead(item.file, self.workdir) } catch (error) { warn(`could not mark ${item.message.id} read: ${describeError(error)}`) }
      }
    }
    const lines = []
    if (authorized.length === 0) lines.push('No unread messages.')
    for (const item of authorized) {
      lines.push(
        `from: ${item.message.from}`,
        `kind: ${item.message.kind ?? 'chat'}`,
        `message id: ${item.message.id}`,
        `sent: ${iso(item.message.createdAt)}`,
        '---',
        item.message.text,
        '',
      )
    }
    if (blocked > 0) lines.push(`${blocked} message(s) blocked by authorization.`)
    if (result.rejected > 0) lines.push(`Quarantined ${result.rejected} invalid or oversized message file(s).`)
    if (result.truncated > 0) lines.push(`${result.truncated} more message file(s) were not read in this call.`)
    if (peer !== undefined && selected.length === 0 && result.messages.length > 0) {
      lines.push(`Other peers still have ${result.messages.length} queued message(s); omit peer to read them.`)
    }
    return lines.join('\n').trimEnd()
  }

  const requireSupervisor = (exec) => {
    const sessionId = exec?.agent?.id
    if (!isSupervisorSession(sessionId)) throw new Error('this tool is available only to a supervisor session')
    return requireSelf(exec)
  }

  const requireWorker = (exec) => {
    const sessionId = exec?.agent?.id
    if (!isManagedWorker(sessionId)) throw new Error('this tool is available only to a registered worker session')
    return requireSelf(exec)
  }

  /** Stable short digest of one capability description. */
  const capabilityVersionOf = (name, description) => crypto
    .createHash('sha256')
    .update(`${name}\n${description}`)
    .digest('hex')
    .slice(0, 16)

  /** Current worker-owned capability, derived from title and base prompt. */
  const liveCapability = (worker) => {
    const entry = registry.get(worker)
    if (entry === undefined) return null
    let description = ''
    let updatedAt = entry.updatedAt
    try {
      const meta = readJson(path.join(entry.workdir, 'session.json'))
      if (typeof meta?.basePrompt === 'string') description = meta.basePrompt
      if (typeof meta?.updatedAt === 'number') updatedAt = meta.updatedAt
    } catch { /* the worker may not have a readable session yet */ }
    const name = typeof entry.title === 'string' && entry.title.trim().length > 0 ? entry.title.trim() : worker
    return {
      name,
      description,
      version: capabilityVersionOf(name, description),
      updatedAt,
      source: 'live',
    }
  }

  /** Effective capability: a human override if present, otherwise the live one. */
  const effectiveCapability = (relationship) => {
    if (relationship === null || relationship === undefined) return null
    const live = liveCapability(relationship.worker)
    const override = relationship.capabilityOverride
    if (override !== null && override !== undefined) {
      return {
        ...override,
        source: 'override',
        version: capabilityVersionOf(override.name, override.description ?? ''),
        live,
        changed: live !== null && relationship.capabilityVersion !== undefined
          ? live.version !== relationship.capabilityVersion
          : false,
      }
    }
    if (live === null) return null
    return {
      ...live,
      changed: relationship.capabilityVersion !== undefined
        ? live.version !== relationship.capabilityVersion
        : false,
    }
  }

  /** Compact live capability lines injected into the supervisor prompt each turn. */
  const capabilityRoster = (supervisor) => relationships.listForSupervisor(supervisor)
    .filter(relationship => relationship.offer === true && isFunctionalWorker(relationship.worker))
    .map(relationship => {
    const capability = effectiveCapability(relationship)
    const name = capability?.name ?? '(request-only)'
    const description = capability?.description ?? ''
    const source = capability?.source ?? 'none'
    const version = capability?.version ?? '-'
    return `- ${relationship.worker} capability=${JSON.stringify(name)} source=${source} version=${version}${capability?.changed === true ? ' changed=yes' : ''}${description.length === 0 ? '' : ` description=${JSON.stringify(description.slice(0, 500))}`}`
  })

  const isFunctionalWorker = (sessionId) => registry.get(sessionId)?.preset === PRESET

  const workerCandidates = (supervisor) => registry.list()
    .filter(entry => entry.sessionId !== supervisor && entry.preset === PRESET)
    .map(entry => {
      const capability = liveCapability(entry.sessionId)
      return {
        sessionId: entry.sessionId,
        title: entry.title ?? null,
        online: ctx.agents.get(entry.sessionId) !== undefined,
        authorized: auth.isAuthorized(supervisor, entry.sessionId),
        basePrompt: capability?.description ?? '',
        capability,
        relationship: relationships.get(supervisor, entry.sessionId) ?? null,
      }
    })

  const taskLine = (task) => (
    `- ${task.id} [${task.status}] worker=${task.worker ?? 'unassigned'} task=${task.taskId ?? '-'} title=${JSON.stringify(task.title)}`
  )

  /** Turn number for one executing tool call, when the session event is known. */
  const turnForCall = (exec) => {
    const found = callTurns.get(String(exec?.callId))
    if (found === undefined) return undefined
    if (typeof exec?.agent?.id === 'string' && found.sessionId !== exec.agent.id) return undefined
    return found.turn
  }

  const taskDetail = (task) => ({
    id: task.id,
    subtaskId: task.id,
    taskId: task.taskId,
    supervisor: task.supervisor,
    worker: task.worker,
    title: task.title,
    instruction: task.instruction,
    inputs: task.inputs,
    acceptance: task.acceptance,
    status: task.status,
    attempts: task.attempts,
    createdTurn: task.createdTurn,
    assignedTurn: task.assignedTurn,
    capabilityVersion: task.capabilityVersion,
    result: task.result,
    failure: task.failure,
    history: task.history,
  })

  const deliveryDirFor = (task) => deliveryRoot(task.taskId)

  const reconcileRequestProjectBindings = () => {
    for (const request of requests.list().sort((left, right) => left.createdAt - right.createdAt)) {
      if (request.status !== 'accepted' || typeof request.taskId !== 'string') continue
      const project = tasks.project(request.taskId)
      if (project === undefined) continue
      if ((project.requestId ?? null) === null) {
        try {
          tasks.bindTask(project.id, request.id)
        } catch (error) {
          warn(`could not bind legacy request ${request.id} to project ${project.id}: ${describeError(error)}`)
        }
      }
      if (request.delivery !== null) {
        try { requests.markDelivered(request.id, request.delivery) } catch (error) {
          warn(`could not promote legacy delivery ${request.id}: ${describeError(error)}`)
        }
      }
    }
  }

  const pruneDeliveryAliases = () => {
    const root = path.join(sharedRoot, '.deliveries')
    let entries
    try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return }
    const active = new Set(
      requests.list()
        .map(request => request.delivery?.deliveryId)
        .filter(id => typeof id === 'string'),
    )
    const now = Date.now()
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      if (active.has(entry.name)) continue
      const target = path.join(root, entry.name)
      try {
        const age = now - fs.statSync(target).mtimeMs
        if (age > 7 * 24 * 60 * 60 * 1000) fs.rmSync(target, { recursive: true, force: true })
      } catch { /* alias may disappear concurrently */ }
    }
  }

  const taskTools = [
    {
      name: 'collab_capabilities',
      description: 'List functional sessions registered to this supervisor, their capabilities, authorization, online state, and active task count.',
      parameters: NO_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      isConcurrencySafe: () => true,
      execute: (_args, exec) => {
        const self = requireSupervisor(exec)
        const relationshipsForSelf = relationships.listForSupervisor(self.sessionId)
          .filter(relationship => relationship.offer === true && isFunctionalWorker(relationship.worker))
        if (relationshipsForSelf.length === 0) return 'No functional sessions are registered to this supervisor yet.'
        const lines = [`supervisor: ${self.sessionId}`, '']
        for (const relationship of relationshipsForSelf) {
          if (relationship.offer !== true) continue
          const worker = registry.get(relationship.worker)
          const online = ctx.agents.get(relationship.worker) !== undefined
          const authorized = auth.isAuthorized(self.sessionId, relationship.worker)
          const active = tasks.activeCount(relationship.worker)
          const capability = effectiveCapability(relationship)
          const name = capability?.name ?? '(request-only)'
          const description = capability?.description ?? ''
          const source = capability?.source ?? 'none'
          const version = capability?.version ?? '-'
          const changed = capability?.changed === true ? 'yes' : 'no'
          lines.push(
            `- ${relationship.worker}  capability=${JSON.stringify(name)}  source=${source}  version=${version}  changed=${changed}  offer=${relationship.offer ? 'yes' : 'no'}  authorized=${authorized ? 'yes' : 'no'}  ${online ? 'online' : 'offline'}  active=${String(active)}${description.length === 0 ? '' : `  description=${JSON.stringify(description)}`}${worker?.title === undefined ? '' : `  title=${JSON.stringify(worker.title)}`}`,
          )
        }
        return lines.join('\n')
      },
    },
    {
      name: 'collab_task_open',
      description: 'Open the parent task for one requirement. Create subtasks under the returned taskId.',
      parameters: TASK_OPEN_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: (args, exec) => {
        const self = requireSupervisor(exec)
        const title = String(args?.title ?? '').trim()
        if (title.length === 0) throw new Error('task title must not be empty')
        const task = tasks.createTask({ supervisor: self.sessionId, title })
        audit.append('task.opened', { taskId: task.id, supervisor: self.sessionId, title })
        return JSON.stringify({ task: TaskStore.taskSummary(task) })
      },
    },
    {
      name: 'collab_task_create',
      description: 'Create a subtask for a functional worker. Omit taskId to create the parent task for this requirement.',
      parameters: TASK_CREATE_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: (args, exec) => {
        const self = requireSupervisor(exec)
        const title = String(args?.title ?? '').trim()
        const instruction = String(args?.instruction ?? '')
        if (title.length === 0) throw new Error('task title must not be empty')
        if (instruction.trim().length === 0) throw new Error('task instruction must not be empty')
        const mentionsSharedCopy = (instruction.includes(sharedRoot) || instruction.includes('/shared/'))
          && /(?:cp|copy|rsync|ln|mv|复制|拷贝|共享目录)/iu.test(instruction)
        if (mentionsSharedCopy) {
          throw new Error('do not create copy-out tasks; workers receive a canonical deliveryDir and publish artifacts there')
        }
        let taskId = typeof args?.taskId === 'string' && args.taskId.trim().length > 0
          ? args.taskId.trim()
          : (typeof args?.projectId === 'string' && args.projectId.trim().length > 0 ? args.projectId.trim() : undefined)
        if (taskId === undefined) {
          const task = tasks.createTask({ supervisor: self.sessionId, title })
          taskId = task.id
        } else {
          const task = tasks.task(taskId)
          if (task === undefined || task.supervisor !== self.sessionId) throw new Error(`unknown task: ${taskId}`)
          if (task.status !== 'open') throw new Error('task is closed')
        }
        const subtask = tasks.createSubtask({
          supervisor: self.sessionId,
          worker: null,
          taskId,
          title,
          instruction,
          inputs: args?.inputs,
          acceptance: args?.acceptance,
          createdTurn: turnForCall(exec),
        })
        return JSON.stringify({ subtask: taskDetail(subtask), taskId })
      },
    },
    {
      name: 'collab_task_assign',
      description: 'Assign a task to a worker with an offer relationship. The worker is woken with the assignment.',
      parameters: TASK_ASSIGN_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: async (args, exec) => {
        const self = requireSupervisor(exec)
        const subtaskId = String(args?.subtaskId ?? args?.taskId ?? '')
        const worker = String(args?.worker ?? '')
        const task = tasks.get(subtaskId)
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error(`unknown subtask: ${subtaskId}`)
        const relationship = relationships.get(self.sessionId, worker)
        if (relationship === undefined || relationship.offer !== true) {
          throw new Error('worker is not registered to this supervisor with an offer capability')
        }
        if (!isFunctionalWorker(worker)) throw new Error('worker must be a collaboration session')
        if (!auth.isAuthorized(self.sessionId, worker)) {
          throw new Error('未授权：请在“协同授权”页授权双方。')
        }
        const project = task.taskId === null ? undefined : tasks.project(task.taskId)
        if (project !== undefined && project.status !== 'open') throw new Error('project is closed')
        const otherActive = tasks.listForWorker(worker)
          .filter(entry => entry.id !== subtaskId && !['done', 'failed', 'cancelled'].includes(entry.status))
          .length
        if (otherActive >= 1) throw new Error('worker already has an active task; capacity is 1')
        const deliveryDir = deliveryRoot(task.taskId)
        mkdirp(deliveryDir, 0o755)
        bindDeliverySandbox(worker, deliveryDir)
        const assigned = tasks.assign(subtaskId, worker, turnForCall(exec), effectiveCapability(relationship)?.version ?? null)
        audit.append('task.assigned', { taskId: assigned.id, supervisor: self.sessionId, worker })
        const payload = {
          type: 'collab-task/assign',
          version: 1,
          taskId: assigned.taskId,
          subtaskId: assigned.id,
          supervisor: self.sessionId,
          title: assigned.title,
          instruction: assigned.instruction,
          inputs: assigned.inputs,
          acceptance: assigned.acceptance,
          deliveryDir,
          attempt: assigned.attempts,
        }
        const delivery = await sendTaskNotice(self, worker, payload)
        return [
          `assigned: ${assigned.id}`,
          `worker: ${worker}`,
          `status: ${assigned.status}`,
          `delivery: ${delivery}`,
          `deliveryDir: ${deliveryDir}`,
        ].join('\n')
      },
    },
    {
      name: 'collab_requests',
      description: 'List work requests. A supervisor sees requests sent to it; any requester session sees its own requests.',
      parameters: REQUEST_LIST_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => collabSessions.has(agent.id),
      isConcurrencySafe: () => true,
      execute: (args, exec) => {
        const self = requireSelf(exec)
        const status = typeof args?.status === 'string' && args.status.trim().length > 0 ? args.status.trim() : undefined
        const list = isSupervisorSession(self.sessionId)
          ? requests.listForSupervisor(self.sessionId, status).map(RequestStore.summary)
          : requests.listForRequester(self.sessionId, status).map(RequestStore.requesterSummary)
        if (list.length === 0) return 'No requests.'
        return JSON.stringify(list)
      },
    },
    {
      name: 'collab_request_accept',
      description: 'Accept a pending work request after the requested work has been decomposed into assigned tasks.',
      parameters: REQUEST_ACCEPT_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: async (args, exec) => {
        const self = requireSupervisor(exec)
        const request = requests.get(String(args?.requestId ?? ''))
        if (request === undefined || request.supervisor !== self.sessionId) throw new Error('unknown request')
        if (request.status !== 'pending') throw new Error(`request is already ${request.status}`)
        const taskId = String(args?.taskId ?? args?.projectId ?? '')
        const task = tasks.task(taskId)
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error('unknown task for this request')
        if (task.status !== 'open') throw new Error('task is closed')
        const assigned = tasks.listForSupervisor(self.sessionId).filter(subtask => (
          subtask.taskId === taskId
          && subtask.worker !== null
          && relationships.hasOffer(subtask.worker)
          && subtask.status !== 'cancelled'
        ))
        if (assigned.length === 0) throw new Error('assign at least one subtask to an offered worker before accepting')
        if (!auth.isAuthorized(self.sessionId, request.requester)) throw new Error('未授权：请在“协同授权”页授权双方。')
        const existingBinding = task.requestId ?? null
        if (existingBinding !== null && existingBinding !== request.id) {
          throw new Error('task is already bound to another request')
        }
        const acceptedAt = Date.now()
        audit.append('request.accepted', { requestId: request.id, taskId, supervisor: self.sessionId })
        const accepted = requests.accept(request.id, {
          taskId,
          subtaskIds: assigned.map(subtask => subtask.id),
          response: typeof args?.response === 'string' ? args.response : null,
          executionDeadlineAt: acceptedAt + executionTimeoutMs,
        }, acceptedAt)
        try {
          tasks.bindTask(taskId, request.id)
        } catch (error) {
          try { requests.reopen(request.id) } catch { /* preserve the binding failure */ }
          throw error
        }
        clearRequestTimer(request.id)
        scheduleExecutionDeadline(accepted)
        const payload = {
          type: 'collab-task/request-accepted',
          version: 1,
          requestId: accepted.id,
          title: accepted.title,
          status: accepted.status,
        }
        const delivery = await sendTaskNotice(self, request.requester, payload)
        return JSON.stringify({
          request: RequestStore.summary(accepted),
          tasks: assigned.map(task => TaskStore.summary(task)),
          delivery,
        })
      },
    },
    {
      name: 'collab_request_reject',
      description: 'Reject a pending work request with the missing capability or another concrete reason.',
      parameters: REQUEST_REJECT_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: async (args, exec) => {
        const self = requireSupervisor(exec)
        const request = requests.get(String(args?.requestId ?? ''))
        if (request === undefined || request.supervisor !== self.sessionId) throw new Error('unknown request')
        if (request.status !== 'pending') throw new Error(`request is already ${request.status}`)
        if (!auth.isAuthorized(self.sessionId, request.requester)) throw new Error('未授权：请在“协同授权”页授权双方。')
        const rejected = requests.reject(request.id, String(args?.reason ?? ''))
        clearRequestTimer(request.id)
        const payload = {
          type: 'collab-task/request-rejected',
          version: 1,
          requestId: rejected.id,
          title: rejected.title,
          reason: rejected.reason,
        }
        const delivery = await sendTaskNotice(self, request.requester, payload)
        return JSON.stringify({ request: RequestStore.summary(rejected), delivery })
      },
    },
    {
      name: 'collab_request_heartbeat',
      description: 'Report progress on an accepted request and optionally extend its execution deadline.',
      parameters: REQUEST_HEARTBEAT_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: async (args, exec) => {
        const self = requireSupervisor(exec)
        const request = requests.get(String(args?.requestId ?? ''))
        if (request === undefined || request.supervisor !== self.sessionId) throw new Error('unknown request')
        if (request.status !== 'accepted') throw new Error(`request is ${request.status}, not accepted`)
        if (!auth.isAuthorized(self.sessionId, request.requester)) throw new Error('未授权：请在“协同授权”页授权双方。')
        const updated = requests.heartbeat(request.id, {
          note: typeof args?.note === 'string' ? args.note : null,
          extendByMs: Number.isFinite(Number(args?.extendByMs)) ? Number(args.extendByMs) : 0,
        })
        scheduleExecutionDeadline(updated)
        const payload = {
          type: 'collab-task/request-progress',
          version: 1,
          requestId: updated.id,
          title: updated.title,
          deadline: updated.executionDeadlineAt,
          ...(typeof args?.note === 'string' && args.note.length > 0 ? { note: args.note } : {}),
        }
        const delivery = await sendTaskNotice(self, updated.requester, payload)
        return JSON.stringify({ request: RequestStore.summary(updated), delivery })
      },
    },
    {
      name: 'collab_tasks',
      description: 'List tasks for this supervisor or, for a worker, the tasks assigned to it.',
      parameters: TASK_LIST_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id) || isManagedWorker(agent.id),
      isConcurrencySafe: () => true,
      execute: (args, exec) => {
        const self = requireSelf(exec)
        const status = typeof args?.status === 'string' && args.status.trim().length > 0 ? args.status.trim() : undefined
        const list = isSupervisorSession(self.sessionId)
          ? tasks.listForSupervisor(self.sessionId, status)
          : tasks.listForWorker(self.sessionId, status)
        if (list.length === 0) return 'No tasks.'
        return list.map(taskLine).join('\n')
      },
    },
    {
      name: 'collab_task_result',
      description: 'Read one task detail and result. Only tasks owned by this supervisor are returned.',
      parameters: TASK_ID_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      isConcurrencySafe: () => true,
      execute: (args, exec) => {
        const self = requireSupervisor(exec)
        const task = tasks.get(String(args?.taskId ?? ''))
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error('unknown task')
        return JSON.stringify(taskDetail(task))
      },
    },
    {
      name: 'collab_task_retry',
      description: 'Reset a failed/cancelled/completed task to created so it can be assigned again.',
      parameters: TASK_ID_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: (args, exec) => {
        const self = requireSupervisor(exec)
        const taskId = String(args?.taskId ?? '')
        const task = tasks.get(taskId)
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error('unknown task')
        const retried = tasks.retry(taskId)
        return `retried: ${retried.id}\nstatus: ${retried.status}`
      },
    },
    {
      name: 'collab_task_reject',
      description: 'Reject a completed task, returning it to the worker with a revision instruction.',
      parameters: TASK_REJECT_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: async (args, exec) => {
        const self = requireSupervisor(exec)
        const taskId = String(args?.taskId ?? '')
        const task = tasks.get(taskId)
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error('unknown task')
        if (task.worker === null) throw new Error('task has no worker')
        const rejected = tasks.reject(taskId, String(args?.reason ?? ''))
        const payload = {
          type: 'collab-task/assign',
          version: 1,
          taskId: rejected.taskId,
          subtaskId: rejected.id,
          supervisor: self.sessionId,
          title: rejected.title,
          instruction: rejected.instruction,
          inputs: rejected.inputs,
          acceptance: rejected.acceptance,
          deliveryDir: deliveryDirFor(rejected),
          attempt: rejected.attempts,
          revision: String(args?.reason ?? ''),
        }
        await sendTaskNotice(self, rejected.worker, payload)
        return `rejected: ${rejected.id}\nstatus: ${rejected.status}`
      },
    },
    {
      name: 'collab_task_cancel',
      description: 'Cancel a task that has not completed.',
      parameters: TASK_ID_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: (args, exec) => {
        const self = requireSupervisor(exec)
        const task = tasks.get(String(args?.taskId ?? ''))
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error('unknown task')
        const cancelled = tasks.cancel(task.id)
        return `cancelled: ${cancelled.id}`
      },
    },
    {
      name: 'collab_task_close',
      description: 'Close a task after all its subtasks are done or cancelled.',
      parameters: TASK_CLOSE_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: (args, exec) => {
        const self = requireSupervisor(exec)
        const taskId = String(args?.taskId ?? args?.projectId ?? '')
        const task = tasks.task(taskId)
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error('unknown task')
        const owned = tasks.listForSupervisor(self.sessionId).filter(subtask => subtask.taskId === taskId)
        const active = owned.filter(subtask => !['done', 'cancelled'].includes(subtask.status))
        if (active.length > 0) {
          throw new Error(`task still has ${String(active.length)} active subtask(s); complete or cancel them before closing`)
        }
        const closed = tasks.closeTask(taskId)
        audit.append('task.closed', { taskId, supervisor: self.sessionId })
        for (const task of owned) {
          if (task.worker !== null) releaseDeliverySandbox(task.worker, deliveryRoot(taskId))
        }
        return `closed: ${closed.id}\nstatus: ${closed.status}`
      },
    },
    {
      name: 'collab_delivery_list',
      description: 'List canonical delivery files for this supervisor\'s tasks. Names, sizes, and times only; content is not read.',
      parameters: DELIVERY_LIST_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      isConcurrencySafe: () => true,
      execute: (args, exec) => {
        const self = requireSupervisor(exec)
        const taskId = typeof args?.taskId === 'string' && args.taskId.trim().length > 0
          ? args.taskId.trim()
          : (typeof args?.projectId === 'string' && args.projectId.trim().length > 0 ? args.projectId.trim() : undefined)
        if (taskId !== undefined) {
          const task = tasks.task(taskId)
          if (task === undefined || task.supervisor !== self.sessionId) throw new Error('unknown task')
          const files = listDeliveryFiles(path.join(sharedRoot, taskId, 'artifacts'))
          if (files.length === 0) return 'No delivery files.'
          const lines = files.map(file => `${file.path}  ${String(file.size)}B  ${iso(file.modifiedAt)}`)
          if (files.truncated === true) lines.push(`(truncated at ${MAX_DELIVERY_LIST_FILES} files)`)
          return lines.join('\n')
        }
        const lines = []
        for (const task of tasks.listTasks(self.sessionId)) {
          const files = listDeliveryFiles(path.join(sharedRoot, task.id, 'artifacts'))
          for (const file of files) {
            lines.push(`${task.id}/${file.path}  ${String(file.size)}B  ${iso(file.modifiedAt)}`)
          }
          if (files.truncated === true) lines.push(`${task.id}/(truncated at ${MAX_DELIVERY_LIST_FILES} files)`)
        }
        return lines.length === 0 ? 'No delivery files.' : lines.join('\n')
      },
    },
    {
      name: 'collab_delivery_manifest',
      description: 'Build and persist a canonical delivery manifest (path, bytes, sha256, mode) for a supervisor task.',
      parameters: DELIVERY_MANIFEST_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: (args, exec) => {
        const self = requireSupervisor(exec)
        const taskId = String(args?.taskId ?? args?.projectId ?? '')
        const task = tasks.task(taskId)
        if (task === undefined || task.supervisor !== self.sessionId) throw new Error('unknown task')
        return JSON.stringify(buildDeliveryManifest(taskId))
      },
    },
    {
      name: 'collab_request_deliver',
      description: 'Send the sanitized delivery manifest for an accepted request to its requester. Does not expose task assignments, worker ids, or internal scheduling.',
      parameters: REQUEST_DELIVER_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isSupervisorSession(agent.id),
      execute: async (args, exec) => {
        const self = requireSupervisor(exec)
        const request = requests.get(String(args?.requestId ?? ''))
        if (request === undefined || request.supervisor !== self.sessionId) throw new Error('unknown request')
        if (request.status !== 'accepted' && request.status !== 'delivered') {
          throw new Error(`request is ${request.status}, not delivery-ready`)
        }
        if (request.taskId === null) throw new Error('accepted request has no task')
        const task = tasks.task(request.taskId)
        if (task === undefined) throw new Error('request task no longer exists')
        if (task.requestId !== request.id) throw new Error('task is not bound to this request')
        if (task.status !== 'closed') throw new Error('close the task before delivery')
        const activeTasks = tasks.listForSupervisor(self.sessionId)
          .filter(subtask => subtask.taskId === task.id && !['done', 'cancelled'].includes(subtask.status))
        if (activeTasks.length > 0) throw new Error('all subtasks must be done or cancelled before delivery')
        if (deliveryInFlight.has(request.id)) throw new Error('delivery is already in progress')
        if (!auth.isAuthorized(self.sessionId, request.requester)) throw new Error('未授权：请在“协同授权”页授权双方。')
        deliveryInFlight.add(request.id)
        try {
          const manifest = buildDeliveryManifest(request.taskId)
          if (manifest.files.length === 0) throw new Error('delivery has no artifacts')
        const manifestSha256 = crypto.createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex')
        const deliveryId = `delivery-${manifestSha256.slice(0, 16)}`
        if (request.delivery !== null && request.delivery.manifestSha256 === manifestSha256) {
          return JSON.stringify({
            requestId: request.id,
            alreadyDelivered: true,
            deliveryId: request.delivery.deliveryId,
            files: manifest.files.length,
          })
        }
        const supersedes = request.delivery === null ? null : request.delivery.deliveryId
        const publicRoot = publishDeliveryAlias(request.taskId, deliveryId)
        const payload = {
          type: 'collab-task/request-delivered',
          version: 1,
          requestId: request.id,
          title: request.title,
          deliveryId,
          manifestSha256,
          ...(supersedes === null ? {} : { supersedes }),
          root: publicRoot,
          files: manifest.files,
        }
          const delivery = await sendTaskNotice(self, request.requester, payload)
          const recorded = requests.markDelivered(request.id, {
            deliveryId,
            manifestSha256,
            deliveredAt: Date.now(),
            ...(supersedes === null ? {} : { supersedes }),
          })
          audit.append('delivery.published', { requestId: request.id, taskId: request.taskId, deliveryId })
          clearExecutionTimer(request.id)
          return JSON.stringify({ requestId: request.id, status: recorded.status, files: manifest.files.length, deliveryId, delivery })
        } finally {
          deliveryInFlight.delete(request.id)
        }
      },
    },
    {
      name: 'collab_task_accept',
      description: 'Accept an assigned task and return its instructions, acceptance criteria, and delivery directory.',
      parameters: TASK_ID_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isManagedWorker(agent.id),
      execute: (args, exec) => {
        const self = requireWorker(exec)
        const task = tasks.get(String(args?.taskId ?? ''))
        if (task === undefined || task.worker !== self.sessionId) throw new Error('unknown task for this worker')
        const accepted = tasks.accept(task.id, self.sessionId)
        const deliveryDir = deliveryDirFor(accepted)
        bindDeliverySandbox(self.sessionId, deliveryDir)
        return JSON.stringify({ ...taskDetail(accepted), deliveryDir })
      },
    },
    {
      name: 'collab_task_progress',
      description: 'Record progress on an accepted task.',
      parameters: TASK_PROGRESS_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isManagedWorker(agent.id),
      execute: (args, exec) => {
        const self = requireWorker(exec)
        const task = tasks.get(String(args?.taskId ?? ''))
        if (task === undefined || task.worker !== self.sessionId) throw new Error('unknown task for this worker')
        const progressed = tasks.progress(task.id, self.sessionId, String(args?.note ?? ''))
        return `progress: ${progressed.id}\nstatus: ${progressed.status}`
      },
    },
    {
      name: 'collab_task_complete',
      description: 'Complete a task and notify its supervisor with the result summary.',
      parameters: TASK_COMPLETE_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isManagedWorker(agent.id),
      execute: async (args, exec) => {
        const self = requireWorker(exec)
        const task = tasks.get(String(args?.taskId ?? ''))
        if (task === undefined || task.worker !== self.sessionId) throw new Error('unknown task for this worker')
        const completed = tasks.complete(task.id, self.sessionId, {
          summary: args?.summary,
          details: args?.details,
          artifacts: args?.artifacts,
        })
        audit.append('task.completed', { taskId: completed.id, worker: self.sessionId })
        const delivery = await sendTaskNotice(self, completed.supervisor, {
          type: 'collab-task/result',
          version: 1,
          taskId: completed.id,
          status: 'done',
        })
        return [
          `completed: ${completed.id}`,
          `status: ${completed.status}`,
          `delivery: ${delivery}`,
        ].join('\n')
      },
    },
    {
      name: 'collab_task_fail',
      description: 'Report a task failure to its supervisor.',
      parameters: TASK_FAIL_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => isManagedWorker(agent.id),
      execute: async (args, exec) => {
        const self = requireWorker(exec)
        const task = tasks.get(String(args?.taskId ?? ''))
        if (task === undefined || task.worker !== self.sessionId) throw new Error('unknown task for this worker')
        const failed = tasks.fail(task.id, self.sessionId, String(args?.reason ?? ''))
        const delivery = await sendTaskNotice(self, failed.supervisor, {
          type: 'collab-task/result',
          version: 1,
          taskId: failed.id,
          status: 'failed',
        })
        return [
          `failed: ${failed.id}`,
          `status: ${failed.status}`,
          `delivery: ${delivery}`,
        ].join('\n')
      },
    },
    {
      name: 'collab_request_submit',
      description: 'Ask an authorized supervisor to evaluate and decompose work. No offer/worker relationship is required; bilateral authorization is enough.',
      parameters: REQUEST_SUBMIT_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => collabSessions.has(agent.id) && !isSupervisorSession(agent.id),
      execute: async (args, exec) => {
        const self = requireSelf(exec)
        const eligible = registry.list()
          .filter(entry => entry.preset === SUPERVISOR && auth.isAuthorized(self.sessionId, entry.sessionId))
        if (eligible.length === 0) {
          throw new Error('no authorized supervisor; authorize a supervisor pair in the authorization page first')
        }
        const targetId = typeof args?.supervisor === 'string' && args.supervisor.trim().length > 0
          ? args.supervisor.trim()
          : undefined
        let supervisor
        if (targetId !== undefined) {
          supervisor = eligible.find(candidate => candidate.sessionId === targetId)
          if (supervisor === undefined) throw new Error('target supervisor is not authorized for this session')
        } else if (eligible.length === 1) {
          supervisor = eligible[0]
        } else {
          throw new Error(`specify a supervisor: ${eligible.map(candidate => candidate.sessionId).join(', ')}`)
        }
        const now = Date.now()
        const request = requests.create({
          requester: self.sessionId,
          supervisor: supervisor.sessionId,
          title: String(args?.title ?? ''),
          requirement: String(args?.requirement ?? ''),
          createdTurn: turnForCall(exec),
          expiresAt: now + requestTimeoutMs,
        }, now)
        try {
          const delivery = await sendTaskNotice(self, supervisor.sessionId, {
            type: 'collab-task/request',
            version: 1,
            requestId: request.id,
            requester: self.sessionId,
            title: request.title,
            requirement: request.requirement,
          })
          scheduleRequestTimeout(request)
          return JSON.stringify({ request: RequestStore.requesterSummary(request), delivery })
        } catch (error) {
          try { requests.cancel(request.id, self.sessionId) } catch { /* preserve the original failure */ }
          throw error
        }
      },
    },
    {
      name: 'collab_request_cancel',
      description: 'Cancel one of your pending work requests.',
      parameters: REQUEST_CANCEL_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => collabSessions.has(agent.id) && !isSupervisorSession(agent.id),
      execute: async (args, exec) => {
        const self = requireSelf(exec)
        const request = requests.get(String(args?.requestId ?? ''))
        if (request === undefined || request.requester !== self.sessionId) throw new Error('unknown request')
        const cancelled = requests.cancel(request.id, self.sessionId)
        clearRequestTimer(request.id)
        clearExecutionTimer(request.id)
        if (request.taskId !== null) {
          cancelBoundTask(tasks, request.taskId, worker => releaseDeliverySandbox(worker, deliveryRoot(request.taskId)))
        }
        try {
          await sendTaskNotice(self, request.supervisor, {
            type: 'collab-task/request-cancelled',
            version: 1,
            requestId: cancelled.id,
            title: cancelled.title,
          })
        } catch { /* cancellation remains effective even if the notice cannot be delivered */ }
        return JSON.stringify({ request: RequestStore.requesterSummary(cancelled) })
      },
    },
  ]

  taskTools.push({
    name: 'collab_task_list',
    description: 'List parent tasks for this supervisor.',
    parameters: TASK_LIST_PARAMETERS,
    output: TEXT_OUTPUT,
    when: ({ agent }) => isSupervisorSession(agent.id),
    isConcurrencySafe: () => true,
    execute: (args, exec) => {
      const self = requireSupervisor(exec)
      const status = typeof args?.status === 'string' && args.status.trim().length > 0 ? args.status.trim() : undefined
      const list = tasks.listTasks(self.sessionId)
        .filter(task => status === undefined || task.status === status)
        .map(task => TaskStore.taskSummary(task))
      return list.length === 0 ? 'No tasks.' : JSON.stringify(list)
    },
  })

  taskTools.push(...subtaskAliases(taskTools))

  const tools = [
    {
      name: 'collab_info',
      description: 'Describe this collaboration session: its unique session id, communication and private directories, and known peers.',
      parameters: NO_PARAMETERS,
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      execute: (_args, exec) => infoText(requireSelf(exec)),
    },
    {
      name: 'collab_doctor',
      description: 'Read-only collaboration health summary: registry, relationships, grants, tasks, requests, and audit availability.',
      parameters: NO_PARAMETERS,
      output: TEXT_OUTPUT,
      when: ({ agent }) => collabSessions.has(agent.id),
      isConcurrencySafe: () => true,
      execute: (_args, exec) => {
        const self = requireSelf(exec)
        const relationshipsList = relationships.list()
        const invalidRelationships = relationshipsList.filter(relationship => (
          registry.get(relationship.worker)?.preset !== PRESET
          || registry.get(relationship.supervisor)?.preset !== SUPERVISOR
        ))
        const grants = auth.listGrants()
        const invalidGrants = grants.filter(grant => (
          (registry.get(grant.from) !== undefined && !COLLAB_PRESETS.has(registry.get(grant.from).preset))
          || (registry.get(grant.to) !== undefined && !COLLAB_PRESETS.has(registry.get(grant.to).preset))
        ))
        const tasksForSelf = isSupervisorSession(self.sessionId)
          ? tasks.listTasks(self.sessionId)
          : []
        const requestsForSelf = requests.list()
          .filter(request => request.supervisor === self.sessionId || request.requester === self.sessionId)
        return JSON.stringify({
          sessionId: self.sessionId,
          registry: registry.list().length,
          relationships: relationshipsList.length,
          invalidRelationships: invalidRelationships.length,
          grants: grants.length,
          invalidGrants: invalidGrants.length,
          tasks: tasksForSelf.length,
          activeTasks: tasksForSelf.filter(task => task.status === 'open').length,
          requests: requestsForSelf.length,
          activeRequests: requestsForSelf.filter(request => request.status === 'accepted').length,
          auditEntries: collabAdmin.audit(1).length,
        })
      },
    },
    {
      name: 'collab_peers',
      description: 'List other collaboration sessions with their role, session id, authorization, and online state.',
      when: ({ agent }) => collabSessions.has(agent.id),
      parameters: NO_PARAMETERS,
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      execute: (_args, exec) => {
        const self = requireSelf(exec)
        refreshRegistry()
        return peersText(self)
      },
    },
    {
      name: 'collab_send',
      description: 'Send an authenticated chat message to another collaboration session. The pair must be explicitly authorized; the message is written under comm/<target>/outbox and the target inbox; a live target is woken with a notification and reads it through collab_inbox. Chat never changes task state.',
      when: ({ agent }) => collabSessions.has(agent.id),
      parameters: SEND_PARAMETERS,
      output: TEXT_OUTPUT,
      execute: async (args, exec) => {
        const self = requireSelf(exec)
        const targetId = String(args?.target ?? '').trim()
        const text = String(args?.message ?? '')
        if (!isSessionId(targetId)) throw new Error('target must be an exact session id such as session-<uuid>')
        if (targetId === self.sessionId) throw new Error('a collaboration session cannot send a message to itself')
        const targetEntry = registry.get(targetId)
        if (targetEntry === undefined || !COLLAB_PRESETS.has(targetEntry.preset)) {
          throw new Error('target must be a collaboration session')
        }
        if (!auth.isAuthorized(self.sessionId, targetId)) {
          throw new Error('未授权：请在“协同授权”页授权双方。')
        }
        if (text.trim().length === 0) throw new Error('message must not be empty')
        if (Buffer.byteLength(text) > MAX_MESSAGE_BYTES) throw new Error('message is larger than 64 KiB')
        refreshRegistry()
        const peer = registry.get(targetId)
        if (peer === undefined) throw new Error(`unknown collaboration session: ${targetId}`)
        const peerWorkdir = peer.workdir
        if (typeof peerWorkdir !== 'string' || !isDirectory(peerWorkdir)) {
          throw new Error(`target working directory is missing: ${String(peerWorkdir)}`)
        }
        const message = sendMessage({
          selfId: self.sessionId,
          selfWorkdir: self.workdir,
          peerId: peer.sessionId,
          peerWorkdir,
          kind: 'chat',
          text,
        })
        const delivery = await wakePeer(peer.sessionId, message)
        return [
          `sent: ${message.id}`,
          `from: ${self.sessionId}`,
          `to: ${peer.sessionId}`,
          `delivery: ${delivery}`,
          `credential: ${credentialPath(self.workdir, peer.sessionId)}`,
        ].join('\n')
      },
    },
    {
      name: 'collab_inbox',
      description: 'Read messages queued for this collaboration session. Only explicitly authorized pairs are returned; messages are authenticated with the pair credential, and reading acknowledges them by default.',
      parameters: INBOX_PARAMETERS,
      output: TEXT_OUTPUT,
      execute: (args, exec) => {
        const self = requireSelf(exec)
        const peer = typeof args?.peer === 'string' && args.peer.trim().length > 0 ? args.peer.trim() : undefined
        if (peer !== undefined && !isSessionId(peer)) throw new Error('peer must be an exact session id such as session-<uuid>')
        return inboxText(self, peer, args?.mark_read !== false)
      },
    },
    ...taskTools,
  ]

  ctx.commands.register({
    name: 'collab-auth',
    description: 'List, authorize, or revoke collaboration session communication pairs.',
    recordInput: false,
    handler: (invocation) => {
      const usage = 'usage: /collab-auth [list | authorize <sessionA> <sessionB> | grant <from> <to> | revoke <sessionA> <sessionB>]'
      const parts = invocation.rawInput.trim().split(/\s+/u).filter(Boolean)
      const action = parts[0] ?? 'list'
      const statePayload = () => JSON.stringify({ pairs: auth.listPairs(), pending: auth.listPending() })
      if (action === 'list') {
        return { kind: 'success', text: statePayload() }
      }
      if (action === 'authorize' || action === 'grant' || action === 'revoke') {
        const a = parts[1]
        const b = parts[2]
        if (!isSessionId(a) || !isSessionId(b) || a === b) return { kind: 'error', text: usage }
        if (action === 'revoke') {
          auth.revoke(a, b)
        } else {
          if (!collabAdmin.isKnownCollab(a) || !collabAdmin.isKnownCollab(b)) {
            return { kind: 'error', text: 'authorization requires two known collaboration sessions' }
          }
          if (action === 'authorize') auth.authorize(a, b, invocation.agent.id)
          else auth.grant(a, b, invocation.agent.id)
        }
        return { kind: 'success', text: statePayload() }
      }
      return { kind: 'error', text: usage }
    },
  })

  ctx.commands.register({
    name: 'collab-base',
    description: 'Read or set the current collaboration session base prompt.',
    recordInput: false,
    handler: (invocation) => {
      const usage = 'usage: /collab-base [get | set <base64>]'
      const parts = invocation.rawInput.trim().split(/\s+/u).filter(Boolean)
      const action = parts[0] ?? 'get'
      const sessionId = invocation.agent?.id
      if (!collabSessions.has(sessionId)) {
        return { kind: 'error', text: 'not a collaboration session' }
      }
      const entry = promptFibers.get(sessionId)
      if (entry === undefined) {
        return { kind: 'error', text: 'collaboration session is not initialized' }
      }
      const current = typeof entry.layout.meta.basePrompt === 'string' ? entry.layout.meta.basePrompt : ''
      if (action === 'get') {
        return { kind: 'success', text: JSON.stringify({ basePrompt: current }) }
      }
      if (action === 'set') {
        let text
        try {
          text = Buffer.from(parts[1] ?? '', 'base64').toString('utf8')
        } catch {
          return { kind: 'error', text: usage }
        }
        if (text.length > MAX_BASE_PROMPT) {
          return { kind: 'error', text: `base prompt exceeds ${String(MAX_BASE_PROMPT)} characters` }
        }
        entry.layout.meta.basePrompt = text
        entry.layout.meta.updatedAt = Date.now()
        try {
          writeJson(path.join(entry.layout.workdir, 'session.json'), entry.layout.meta, 0o600)
        } catch (error) {
          return { kind: 'error', text: `could not save base prompt: ${describeError(error)}` }
        }
        return { kind: 'success', text: JSON.stringify({ basePrompt: text }) }
      }
      return { kind: 'error', text: usage }
    },
  })

  ctx.commands.register({
    name: 'collab-link',
    description: 'Manage supervisor-worker authorization and live/pinned capability.',
    recordInput: false,
    handler: (invocation) => {
      const supervisor = invocation.agent?.id
      if (!isSupervisorSession(supervisor)) return { kind: 'error', text: 'not a supervisor session' }
      const usage = 'usage: /collab-link [get | link <worker> <base64-json> | pin <worker> | live <worker> | unlink <worker>]'
      const view = relationship => relationship === undefined
        ? undefined
        : { ...relationship, capability: effectiveCapability(relationship) }
      const parts = invocation.rawInput.trim().split(/\s+/u).filter(Boolean)
      const action = parts[0] ?? 'get'
      if (action === 'get') {
        return {
          kind: 'success',
          text: JSON.stringify({
            relationships: relationships.listForSupervisor(supervisor)
              .filter(relationship => isFunctionalWorker(relationship.worker))
              .map(view),
            workers: workerCandidates(supervisor),
          }),
        }
      }
      if (action === 'link' || action === 'unlink' || action === 'pin' || action === 'live') {
        const worker = parts[1]
        if (!isSessionId(worker) || worker === supervisor) return { kind: 'error', text: usage }
        const entry = registry.get(worker)
        if (entry === undefined || entry.preset !== PRESET) return { kind: 'error', text: 'worker must be a collaboration session' }
        if (action === 'unlink') {
          relationships.remove(supervisor, worker)
          auth.revoke(supervisor, worker)
          return { kind: 'success', text: JSON.stringify({ removed: true, worker, communicationRevoked: true }) }
        }
        const existing = relationships.get(supervisor, worker)
        if ((action === 'pin' || action === 'live') && existing === undefined) {
          return { kind: 'error', text: 'worker is not registered to this supervisor' }
        }
        if (action === 'pin' || action === 'live') {
          const live = liveCapability(worker)
          if (live === null) return { kind: 'error', text: 'worker session is unavailable' }
          try {
            const relationship = relationships.upsert({
              supervisor,
              worker,
              capabilityOverride: action === 'pin' ? live : null,
              capabilityVersion: live.version,
              offer: existing.offer,
              request: existing.request,
              createdBy: 'human',
            })
            return { kind: 'success', text: JSON.stringify({ relationship: view(relationship) }) }
          } catch (error) {
            return { kind: 'error', text: describeError(error) }
          }
        }
        let payload
        try {
          payload = JSON.parse(Buffer.from(parts[2] ?? '', 'base64').toString('utf8'))
        } catch {
          return { kind: 'error', text: 'link payload must be base64-encoded JSON' }
        }
        const live = liveCapability(worker)
        const override = payload?.override === true ? (payload?.capability ?? null) : undefined
        const offer = payload?.offer !== false
        try {
          const relationship = relationships.upsert({
            supervisor,
            worker,
            capabilityOverride: override,
            capabilityVersion: live?.version,
            offer,
            createdBy: 'human',
          })
          auth.authorize(supervisor, worker, 'relationship')
          return { kind: 'success', text: JSON.stringify({ relationship: view(relationship), authorized: true }) }
        } catch (error) {
          return { kind: 'error', text: describeError(error) }
        }
      }
      return { kind: 'error', text: usage }
    },
  })

  ctx.commands.register({
    name: 'collab-board',
    description: 'Read the supervisor dashboard: relationships, tasks, subtasks, and worker candidates.',
    recordInput: false,
    handler: (invocation) => {
      const supervisor = invocation.agent?.id
      if (!isSupervisorSession(supervisor)) return { kind: 'error', text: 'not a supervisor session' }
      return {
        kind: 'success',
        text: JSON.stringify({
          relationships: relationships.listForSupervisor(supervisor)
            .filter(relationship => isFunctionalWorker(relationship.worker))
            .map(relationship => ({
            ...relationship,
            capability: effectiveCapability(relationship),
          })),
          workers: workerCandidates(supervisor),
          tasks: tasks.listTasks(supervisor).map(task => TaskStore.taskSummary(task)),
          subtasks: tasks.listForSupervisor(supervisor).map(subtask => TaskStore.summary(subtask)),
          requests: requests.listForSupervisor(supervisor).map(request => RequestStore.summary(request)),
        }),
      }
    },
  })

  /** Management operations used by the UI Remote instead of slash commands. */
  const panel = (sessionId, operation, args) => {
    if (!isSessionId(sessionId) || !collabSessions.has(sessionId)) {
      throw new Error('not an initialized collaboration session')
    }
    const op = String(operation ?? '')
    const supervisor = isSupervisorSession(sessionId)
    if (op === 'board') {
      if (!supervisor) throw new Error('not a supervisor session')
      return {
        relationships: relationships.listForSupervisor(sessionId)
          .filter(relationship => isFunctionalWorker(relationship.worker))
          .map(relationship => ({
          ...relationship,
          capability: effectiveCapability(relationship),
        })),
        workers: workerCandidates(sessionId),
        tasks: tasks.listTasks(sessionId).map(task => TaskStore.taskSummary(task)),
        subtasks: tasks.listForSupervisor(sessionId).map(subtask => ({
          ...TaskStore.summary(subtask),
          workerTitle: registry.get(subtask.worker)?.title ?? null,
        })),
        requests: requests.listForSupervisor(sessionId).map(request => ({
          ...RequestStore.summary(request),
          requesterTitle: registry.get(request.requester)?.title ?? null,
        })),
      }
    }
    if (op === 'baseGet' || op === 'baseSet') {
      const entry = promptFibers.get(sessionId)
      if (entry === undefined) throw new Error('collaboration session is not initialized')
      if (op === 'baseGet') {
        return { basePrompt: typeof entry.layout.meta.basePrompt === 'string' ? entry.layout.meta.basePrompt : '' }
      }
      const value = typeof args?.value === 'string' ? args.value : ''
      if (value.length > MAX_BASE_PROMPT) throw new Error(`base prompt exceeds ${String(MAX_BASE_PROMPT)} characters`)
      entry.layout.meta.basePrompt = value
      entry.layout.meta.updatedAt = Date.now()
      writeJson(path.join(entry.layout.workdir, 'session.json'), entry.layout.meta, 0o600)
      return { basePrompt: value }
    }
    if (op !== 'link' && op !== 'unlink' && op !== 'pin' && op !== 'live') {
      throw new Error(`unknown panel operation: ${op}`)
    }
    if (!supervisor) throw new Error('not a supervisor session')
    const worker = typeof args?.worker === 'string' ? args.worker : ''
    if (!isSessionId(worker) || worker === sessionId) throw new Error('invalid worker id')
    const entry = registry.get(worker)
    if (entry === undefined || entry.preset !== PRESET) throw new Error('worker must be a collaboration session')
    const view = relationship => relationship === undefined
      ? undefined
      : { ...relationship, capability: effectiveCapability(relationship) }
    if (op === 'unlink') {
      relationships.remove(sessionId, worker)
      auth.revoke(sessionId, worker)
      return { removed: true, worker, communicationRevoked: true }
    }
    const existing = relationships.get(sessionId, worker)
    if ((op === 'pin' || op === 'live') && existing === undefined) {
      throw new Error('worker is not registered to this supervisor')
    }
    if (op === 'pin' || op === 'live') {
      const live = liveCapability(worker)
      if (live === null) throw new Error('worker session is unavailable')
      const relationship = relationships.upsert({
        supervisor: sessionId,
        worker,
        capabilityOverride: op === 'pin' ? live : null,
        capabilityVersion: live.version,
        offer: existing.offer,
        request: existing.request,
        createdBy: 'human',
      })
      return { relationship: view(relationship) }
    }
    const payload = args?.payload !== null && typeof args?.payload === 'object' ? args.payload : {}
    const live = liveCapability(worker)
    const override = payload?.override === true ? (payload?.capability ?? null) : undefined
    const offer = payload?.offer !== false
    const relationship = relationships.upsert({
      supervisor: sessionId,
      worker,
      capabilityOverride: override,
      capabilityVersion: live?.version,
      offer,
      createdBy: 'human',
    })
    auth.authorize(sessionId, worker, 'relationship')
    return { relationship: view(relationship), authorized: true }
  }
  collabAdmin.panel = panel
  Object.assign(collabAdmin, createPanelApi(panel))

  for (const definition of tools) {
    const { when, ...tool } = definition
    ctx.tools.register(tool, {
      when: when ?? (({ agent }) => collabSessions.has(agent.id)),
    })
  }

  ctx.tools.guard((exec) => {
    if (exec?.agent === undefined || !isSessionId(exec.agent.id)) return undefined
    const sessionId = exec.agent.id
    const self = registry.get(sessionId)
    // Relative paths resolve against the session's current directory, which may
    // differ from the collaboration layout after an explicit `cd`.
    const currentCwd = exec.agent.session === undefined ? undefined : ctx.workingDirectory.get(exec.agent.session)
    const selfWorkdir = currentCwd ?? self?.workdir
    if (typeof selfWorkdir !== 'string') return undefined
    const comparablePath = (value) => {
      const resolved = path.resolve(value)
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved
    }
    const pathInside = (candidate, root) => {
      const resolvedCandidate = comparablePath(candidate)
      const resolvedRoot = comparablePath(root)
      return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
    }
    const canonicalSharedRoot = canonicalPath(sharedRoot)
    const projectIdFromShared = (resolved) => {
      if (!pathInside(resolved, canonicalSharedRoot)) return undefined
      const relative = path.relative(canonicalSharedRoot, resolved).split(path.sep).filter(Boolean)
      if (relative.length < 2 || relative[1] !== 'artifacts') return undefined
      return relative[0]
    }
    const deliveryAccessFor = (candidate, write) => {
      if (typeof candidate !== 'string' || candidate.length === 0) return false
      const resolved = canonicalPath(path.resolve(selfWorkdir, candidate))
      const projectId = projectIdFromShared(resolved)
      if (projectId === undefined) return false
      const project = tasks.project(projectId)
      if (project === undefined) return false
      if (isSupervisorSession(sessionId)) return project.supervisor === sessionId && write !== true
      if (isManagedWorker(sessionId)) {
        if (write && project.status !== 'open') return false
        return tasks.listForWorker(sessionId).some(task => (
          task.taskId === projectId && task.supervisor === project.supervisor
        ))
      }
      if (write) return false
      return requests.listForRequester(sessionId).some(request => (
        request.taskId === projectId
        && (request.status === 'delivered' || (request.status === 'accepted' && request.delivery !== null))
        && project.requestId === request.id
        && request.delivery !== null
      ))
    }
    const sharedAccessDenied = (candidates, write) => {
      for (const candidate of candidates) {
        if (typeof candidate !== 'string' || candidate.length === 0) continue
        const lexical = path.resolve(selfWorkdir, candidate)
        const resolved = canonicalPath(lexical)
        if (!pathInside(lexical, sharedRoot) && !pathInside(resolved, canonicalSharedRoot)) continue
        if (pathInside(lexical, sharedRoot) && !pathInside(resolved, canonicalSharedRoot)) return { path: lexical }
        if (deliveryAccessFor(candidate, write)) continue
        return { path: lexical }
      }
      return undefined
    }
    const managedWriteAllowed = (candidate) => {
      if (!isManagedWorker(sessionId)) return true
      if (typeof candidate !== 'string' || candidate.length === 0) return false
      const resolved = canonicalPath(path.resolve(selfWorkdir, candidate))
      if (deliveryAccessFor(candidate, true)) return true
      const layoutWorkdir = self?.workdir ?? selfWorkdir
      for (const own of [path.join(layoutWorkdir, 'private'), path.join(layoutWorkdir, 'comm')]) {
        if (pathInside(resolved, canonicalPath(own))) return true
      }
      return false
    }
    const allowedDeliveryPaths = (candidates, write) => candidates.filter(candidate => !deliveryAccessFor(candidate, write))

    const byId = new Map()
    for (const entry of registry.list()) {
      if (typeof entry.workdir === 'string') byId.set(entry.sessionId, { sessionId: entry.sessionId, workdir: entry.workdir })
    }
    if (typeof self?.workdir === 'string') {
      for (const sibling of discoverSiblingWorkdirs(self.workdir)) {
        if (self?.workdir !== undefined && path.resolve(sibling.workdir) === path.resolve(self.workdir)) continue
        if (!byId.has(sibling.sessionId)) byId.set(sibling.sessionId, sibling)
      }
    }
    const roots = [...byId.values()]
    const options = { selfId: sessionId, selfWorkdir, selfLayoutWorkdir: self?.workdir, roots }
    const isCollabCaller = collabSessions.has(sessionId)
    const args = exec.arguments
    let hit
    switch (exec.name) {
      case 'bash':
      case 'pwsh': {
        const shellWorkdir = typeof args?.workdir === 'string' && args.workdir.length > 0
          ? path.resolve(selfWorkdir, args.workdir)
          : selfWorkdir
        // A collaboration shell whose cwd contains another session's work
        // directory could read it recursively; refuse that cwd. Normal project
        // sessions keep their full shell so the plugin does not break them.
        hit = (isCollabCaller ? findForeignAncestorAccess([shellWorkdir], options) : undefined)
          ?? findForeignSessionAccessInCommand(String(args?.command ?? ''), {
            ...options,
            selfWorkdir: shellWorkdir,
            checkAncestors: isCollabCaller,
          })
        if (hit === undefined && typeof args?.workdir === 'string') {
          hit = findForeignSessionAccess(allowedDeliveryPaths([args.workdir], true), options)
        }
        if (hit === undefined && isManagedWorker(sessionId)) {
          for (const target of shellWriteTargets(String(args?.command ?? ''), shellWorkdir)) {
            if (!managedWriteAllowed(target)) { hit = { workerWrite: target }; break }
          }
        }
        break
      }
      case 'working_directory':
        hit = findForeignSessionAccess(
          allowedDeliveryPaths([args?.cd].filter(value => typeof value === 'string'), true),
          options,
        )
        break
      case 'apply_patch': {
        const patch = String(args?.input ?? args?.patch ?? '')
        hit = findForeignSessionAccessInCommand(patch, options)
        if (hit === undefined && isManagedWorker(sessionId)) {
          for (const target of applyPatchTargets(patch, selfWorkdir)) {
            if (!managedWriteAllowed(target)) { hit = { workerWrite: target }; break }
          }
        }
        break
      }
      case 'office_render':
      case 'office_convert':
      case 'office_recalculate':
        hit = findForeignSessionAccess(
          allowedDeliveryPaths([args?.input].filter(value => typeof value === 'string'), true),
          options,
        )
        break
      case 'present':
        hit = findForeignSessionAccess(
          allowedDeliveryPaths(Array.isArray(args?.files) ? args.files.map(file => file?.path).filter(value => typeof value === 'string') : [], false),
          options,
        )
        break
      case 'read':
      case 'read_image':
        hit = findForeignSessionAccess(
          allowedDeliveryPaths([args?.path, args?.file_path, args?.filePath].filter(value => typeof value === 'string'), false),
          options,
        )
        break
      case 'write':
      case 'edit':
        hit = findForeignSessionAccess(
          allowedDeliveryPaths([args?.path, args?.file_path, args?.filePath].filter(value => typeof value === 'string'), true),
          options,
        )
        break
      case 'glob': {
        const globPath = typeof args?.path === 'string' ? args.path : selfWorkdir
        const pathAllowed = deliveryAccessFor(globPath, false)
        hit = findSuspiciousSearchPattern(String(args?.pattern ?? ''), options)
          ?? (isCollabCaller && !pathAllowed
            ? findForeignAncestorAccess([globPath].filter(value => typeof value === 'string'), options)
            : undefined)
          ?? findForeignSessionAccess(
            allowedDeliveryPaths([args?.path, args?.pattern].filter(value => typeof value === 'string'), false),
            options,
          )
        break
      }
      case 'grep': {
        const grepPath = typeof args?.path === 'string' ? args.path : selfWorkdir
        const pathAllowed = deliveryAccessFor(grepPath, false)
        hit = (isCollabCaller && !pathAllowed
          ? findForeignAncestorAccess([grepPath].filter(value => typeof value === 'string'), options)
          : undefined)
          ?? findSuspiciousSearchPattern(String(args?.pattern ?? ''), options)
          ?? findForeignSessionAccess(
            allowedDeliveryPaths([args?.path, args?.pattern].filter(value => typeof value === 'string'), false),
            options,
          )
        break
      }
      default:
        return undefined
    }
    if (hit === undefined) {
      const write = ['write', 'edit', 'apply_patch', 'working_directory', 'office_render', 'office_convert', 'office_recalculate'].includes(exec.name)
      const candidates = []
      if (typeof args?.path === 'string') candidates.push(args.path)
      if (typeof args?.file_path === 'string') candidates.push(args.file_path)
      if (typeof args?.filePath === 'string') candidates.push(args.filePath)
      if (typeof args?.input === 'string') candidates.push(args.input)
      if (typeof args?.cd === 'string') candidates.push(args.cd)
      if (Array.isArray(args?.files)) candidates.push(...args.files.map(file => file?.path).filter(value => typeof value === 'string'))
      if (exec.name === 'bash' || exec.name === 'pwsh') {
        const command = String(args?.command ?? '')
        const shellWorkdir = typeof args?.workdir === 'string' && args.workdir.length > 0
          ? path.resolve(selfWorkdir, args.workdir)
          : selfWorkdir
        if (commandMentionsSharedRoot(command)) {
          if (!sharedCommandAllowed(command, sessionId)) hit = { shared: sharedRoot }
        } else if (isManagedWorker(sessionId)) {
          hit = sharedAccessDenied([shellWorkdir], true)
        }
        if (hit === undefined && !sharedCommandAllowed(command, sessionId)
          && command.split(/\s+/u).some(token => /shared[\\/]/i.test(token))) {
          hit = { shared: path.join(sharedRoot, 'shared') }
        }
      }
      if (hit === undefined) hit = sharedAccessDenied(candidates, write)
      if (hit === undefined && isManagedWorker(sessionId) && ['write', 'edit'].includes(exec.name)) {
        for (const candidate of candidates) {
          if (!managedWriteAllowed(candidate)) { hit = { workerWrite: candidate }; break }
        }
      }
    }
    if (hit === undefined) return undefined
    if (hit.workerWrite !== undefined) {
      return {
        reason: `collab: managed worker may write only its assigned deliveryDir, private/, or comm/ (denied: ${hit.workerWrite})`,
        info: { name: 'CollabWorkerWriteScope', code: 'COLLAB_WORKER_WRITE_SCOPE' },
      }
    }
    if (hit.shared !== undefined) {
      return {
        reason: `collab: shared delivery path is not authorized for this session: ${hit.path ?? hit.shared}. Write only to the deliveryDir assigned by your task; use delivery tools for requester access.`,
        info: { name: 'CollabSharedDeliveryScope', code: 'COLLAB_SHARED_DELIVERY_SCOPE' },
      }
    }
    return {
      reason: `collab: session ${sessionId} may not access the work directory of session ${hit.sessionId}`,
      info: { name: 'CollabWorkdirScope', code: 'COLLAB_WORKDIR_SCOPE' },
    }
  })

  ctx.effect(() => () => {
    for (const timer of requestTimers.values()) clearTimeout(timer)
    requestTimers.clear()
    for (const timer of executionTimers.values()) clearTimeout(timer)
    executionTimers.clear()
  }, 'collab:request-timeouts')

  ctx.effect(() => {
    const timer = setInterval(() => { void flushNotices() }, 5000)
    timer.unref?.()
    return () => clearInterval(timer)
  }, 'collab:notice-outbox')

  const pruneInvalidCollabState = () => {
    for (const grant of auth.listGrants()) {
      const from = registry.get(grant.from)
      const to = registry.get(grant.to)
      if ((from !== undefined && from.preset !== PRESET && from.preset !== SUPERVISOR)
        || (to !== undefined && to.preset !== PRESET && to.preset !== SUPERVISOR)) {
        try { auth.revoke(grant.from, grant.to) } catch (error) { warn(`could not prune invalid grant ${grant.from} -> ${grant.to}: ${describeError(error)}`) }
      }
    }
    for (const relationship of relationships.list()) {
      const worker = registry.get(relationship.worker)
      if (worker !== undefined && worker.preset !== PRESET) {
        try { relationships.remove(relationship.supervisor, relationship.worker) } catch (error) { warn(`could not prune invalid relationship: ${describeError(error)}`) }
      }
    }
  }

  installPerSessionSandbox()
  try { tasks.migrate() } catch (error) { warn(`task state migration failed: ${describeError(error)}`) }
  try { requests.migrate() } catch (error) { warn(`request state migration failed: ${describeError(error)}`) }
  refreshRegistry()
  pruneInvalidCollabState()
  reconcileRequestProjectBindings()
  pruneDeliveryAliases()
  sweepRequestTimeouts()
  sweepExecutionDeadlines()
  void flushNotices()
  for (const entry of registry.list()) {
    try { migrateSessionArchive(entry.workdir) } catch (error) { warn(`archive migration failed for ${entry.sessionId}: ${describeError(error)}`) }
  }
  for (const agent of ctx.agents.list()) void setupAgent(agent)
  ctx.on('agent/created', async ({ agent }) => { await setupAgent(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    sandboxDeliveryRoots.delete(agent.id)
    sandboxReadRoots.delete(agent.id)
    collabSessions.delete(agent.id)
    sessionPresets.delete(agent.id)
    disposePrompt(agent.id)
  })
  ctx.on('agent-preset/selected', async (sessionId, selected) => {
    if (COLLAB_PRESETS.has(selected)) {
      const agent = ctx.agents.get(sessionId)
      if (agent !== undefined) await setupAgent(agent, { force: true, preset: selected })
      return
    }
    collabSessions.delete(sessionId)
    sessionPresets.delete(sessionId)
    disposePrompt(sessionId)
  })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'tool/call') return
    const callId = event.data?.callId
    const turn = event.data?.turn
    if (typeof callId !== 'string' || typeof turn !== 'number') return
    callTurns.set(callId, { sessionId: session.id, turn })
    if (callTurns.size > 2000) {
      const oldest = callTurns.keys().next().value
      if (oldest !== undefined) callTurns.delete(oldest)
    }
  })

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'session/title') return
    const entry = registry.get(session.id)
    if (entry === undefined) return
    const title = event.data?.title
    if (typeof title === 'string' && title.length > 0) {
      registry.upsert({ ...entry, title, updatedAt: Date.now() })
    }
  })

  ctx.effect(() => () => {
    for (const sessionId of [...promptFibers.keys()]) disposePrompt(sessionId)
    collabSessions.clear()
  }, 'collab:agent-registrations')
}

export { SUBDIR, SessionRegistry }
