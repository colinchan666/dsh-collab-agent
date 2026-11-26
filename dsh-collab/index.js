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
import { TEXT_OUTPUT, NO_PARAMETERS, SEND_PARAMETERS, INBOX_PARAMETERS, TASK_OPEN_PARAMETERS, TASK_CREATE_PARAMETERS, TASK_ASSIGN_PARAMETERS, TASK_ID_PARAMETERS, TASK_LIST_PARAMETERS, TASK_REJECT_PARAMETERS, TASK_PROGRESS_PARAMETERS, TASK_COMPLETE_PARAMETERS, TASK_FAIL_PARAMETERS, TASK_CLOSE_PARAMETERS, DELIVERY_LIST_PARAMETERS, DELIVERY_MANIFEST_PARAMETERS, REQUEST_DELIVER_PARAMETERS, REQUEST_SUBMIT_PARAMETERS, REQUEST_LIST_PARAMETERS, REQUEST_ACCEPT_PARAMETERS, REQUEST_REJECT_PARAMETERS, REQUEST_CANCEL_PARAMETERS, REQUEST_HEARTBEAT_PARAMETERS } from './lib/tool-schemas.js'
import { COLLAB_PRESET as PRESET, SUPERVISOR_PRESET as SUPERVISOR, COLLAB_PRESETS } from './lib/presets.js'
import { subtaskAliases } from './lib/task-aliases.js'
import { createDeliveryManifestService } from './lib/delivery-manifest.js'
import { AuditLog } from './lib/audit.js'
import { cancelBoundTask } from './lib/cancel-request.js'
import { createPanelApi } from './lib/panel-api.js'
import { createMessageTools } from './lib/message-tools.js'
import { createRequestTools } from './lib/request-tools.js'
import { createDeliveryTools } from './lib/delivery-tools.js'
import { createTaskTools } from './lib/task-tools.js'
import { createSessionDirectory } from './lib/session-directory.js'
import { collectHealth } from './lib/health.js'
import { createAccessPolicy } from './lib/access-policy.js'
import { promptText } from './lib/prompt.js'
import { taskDetail, taskLine } from './lib/task-views.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'dsh-collab-sessions'

/** Services required for session discovery, tools, prompts, and the working directory. */
export const inject = ['tools', 'agents', 'systemPrompt', 'workingDirectory', 'commands']

const MAX_MESSAGE_BYTES = 64 * 1024

/** Upper bound for one session's configured base prompt. */
const MAX_BASE_PROMPT = 16 * 1024

function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}

function iso(time) {
  return typeof time === 'number' && Number.isFinite(time) ? new Date(time).toISOString() : 'unknown'
}

/** Prompt text visible only inside a collaboration session. */
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
  const sessionDirectory = createSessionDirectory({ registry, sessions: ctx.get('sessions'), sessionTitle: ctx.get('sessionTitle'), agents: ctx.agents })
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
  const isKnownCollab = (id) => {
    if (collabSessions.has(id)) return true
    const entry = registry.get(id)
    return entry !== undefined && entry.archived !== true && (entry.preset === PRESET || entry.preset === SUPERVISOR)
  }
  const collabAdmin = {
    isKnownCollab,
    audit: (limit = 100) => audit.tail(limit),
    listAuth: () => {
      return {
        pairs: auth.listPairs().filter(pair => isKnownCollab(pair.a) && isKnownCollab(pair.b)),
        pending: auth.listPending().filter(grant => isKnownCollab(grant.from) && isKnownCollab(grant.to)),
        sessions: sessionDirectory.list().filter(entry => (entry.preset === PRESET || entry.preset === SUPERVISOR) && entry.archived !== true),
      }
    },
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
        const project = tasks.task(task.taskId)
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
    const entries = sessionDirectory.list().filter(entry => entry.sessionId !== self.sessionId && COLLAB_PRESETS.has(entry.preset) && !entry.archived)
    if (entries.length === 0) {
      return 'No other collaboration sessions are registered yet. Create another one from the left sidebar entry.'
    }
    const lines = [`This session: ${self.sessionId}`, '']
    for (const entry of entries) {
      const online = entry.online
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
    const peers = sessionDirectory.list().filter(entry => entry.sessionId !== self.sessionId && !entry.archived)
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
      const online = peer.online
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

  const workerCandidates = (supervisor) => sessionDirectory.list()
    .filter(entry => entry.sessionId !== supervisor && entry.preset === PRESET && entry.archived !== true)
    .map(entry => {
      const capability = liveCapability(entry.sessionId)
      return {
        sessionId: entry.sessionId,
        title: entry.title,
        online: entry.online,
        authorized: auth.isAuthorized(supervisor, entry.sessionId),
        basePrompt: capability?.description ?? '',
        capability,
        relationship: relationships.get(supervisor, entry.sessionId) ?? null,
      }
    })

  /** Turn number for one executing tool call, when the session event is known. */
  const turnForCall = (exec) => {
    const found = callTurns.get(String(exec?.callId))
    if (found === undefined) return undefined
    if (typeof exec?.agent?.id === 'string' && found.sessionId !== exec.agent.id) return undefined
    return found.turn
  }

  const deliveryDirFor = (task) => deliveryRoot(task.taskId)

  const reconcileRequestProjectBindings = () => {
    for (const request of requests.list().sort((left, right) => left.createdAt - right.createdAt)) {
      if (request.status !== 'accepted' || typeof request.taskId !== 'string') continue
      const project = tasks.task(request.taskId)
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

  const taskTools = createTaskTools({
    ctx, tasks, relationships, auth, registry, requests, audit, deliveryRoot, deliveryDirFor,
    sendTaskNotice, releaseDeliverySandbox, bindDeliverySandbox, isFunctionalWorker,
    effectiveCapability, isSupervisorSession, isManagedWorker, requireSupervisor, requireWorker,
    requireSelf, turnForCall, collabSessions, sessionDirectory, sharedRoot, mkdirp, cancelBoundTask, clearExecutionTimer,
    clearRequestTimer, scheduleRequestTimeout, requestTimeoutMs, subtaskAliases,
  })

  const messageTools = createMessageTools({
    requireSelf, infoText, peersText, refreshRegistry, registry, auth, isSessionId,
    collabSessions, MAX_MESSAGE_BYTES, sendMessage, wakePeer, credentialPath,
    inboxText, isDirectory, collectHealth, tasks, requests, relationships, audit,
    collabAdmin, isSupervisorSession,
  })

  const requestTools = createRequestTools({
    requireSelf, requireSupervisor, requests, tasks, relationships, auth, audit, collabSessions,
    scheduleExecutionDeadline, clearRequestTimer, sendTaskNotice, deliveryRoot, releaseDeliverySandbox,
    taskDetail, isSupervisorSession, isManagedWorker, deliveryDirFor, executionTimeoutMs,
  })

  const deliveryTools = createDeliveryTools({
    requireSupervisor, tasks, requests, auth, sharedRoot, listDeliveryFiles,
    MAX_DELIVERY_LIST_FILES, iso, buildDeliveryManifest, deliveryInFlight,
    publishDeliveryAlias, sendTaskNotice, audit, clearExecutionTimer, isSupervisorSession,
  })

  taskTools.push(...subtaskAliases([...requestTools, ...deliveryTools, ...taskTools]))
  const tools = [...messageTools, ...requestTools, ...deliveryTools, ...taskTools]


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
    name: 'collab-debug',
    description: 'Read-only collaboration candidate diagnostics for the current supervisor.',
    recordInput: false,
    handler: (invocation) => {
      const sessionId = invocation.agent?.id
      if (!isSupervisorSession(sessionId)) return { kind: 'error', text: 'not a supervisor session' }
      return {
        kind: 'success',
        text: JSON.stringify({
          sessionId,
          candidates: workerCandidates(sessionId).map(entry => ({
            sessionId: entry.sessionId,
            title: entry.title,
            archived: registry.get(entry.sessionId)?.archived,
          })),
          relationships: relationships.listForSupervisor(sessionId),
          authSessions: collabAdmin.listAuth().sessions,
        }, null, 2),
      }
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
    if (!isSessionId(sessionId)) throw new Error('not an initialized collaboration session')
    const known = collabSessions.has(sessionId) || registry.get(sessionId) !== undefined
    if (!known) throw new Error('not an initialized collaboration session')
    const op = String(operation ?? '')
    const supervisor = isSupervisorSession(sessionId) || registry.get(sessionId)?.preset === SUPERVISOR
    if (op === 'directory') return sessionDirectory.list()
    if (op === 'backfillTitle') {
      const title = String(args?.title ?? '').trim()
      if (title.length === 0 || title.length > 200) throw new Error('invalid title')
      const entry = registry.get(sessionId)
      if (entry === undefined) throw new Error('unknown collaboration session')
      registry.upsert({ ...entry, title })
      return { sessionId, title }
    }
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
        subtasks: tasks.listForSupervisor(sessionId).map(subtask => TaskStore.summary(subtask)),
        requests: requests.listForSupervisor(sessionId).map(request => RequestStore.summary(request)),
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
    const { deliveryAccessFor, sharedAccessDenied, managedWriteAllowed, allowedDeliveryPaths } = createAccessPolicy({
      sharedRoot,
      sessionId,
      selfWorkdir,
      layoutWorkdir: self?.workdir ?? selfWorkdir,
      tasks,
      requests,
      isSupervisorSession,
      isManagedWorker,
    })

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
  const cleanupArchivedSession = (sessionId, eventName = 'session.archived') => {
    if (!isSessionId(sessionId)) return
    const known = registry.get(sessionId) !== undefined || collabSessions.has(sessionId)
    if (!known) return
    const rels = [
      ...relationships.listForSupervisor(sessionId),
      ...relationships.listForWorker(sessionId),
    ]
    for (const rel of rels) {
      try { relationships.remove(rel.supervisor, rel.worker) } catch { /* best effort */ }
      try { releaseDeliverySandbox(rel.worker, deliveryRoot(rel.taskId)) } catch { /* best effort */ }
    }
    for (const grant of auth.listGrants().filter(grant => grant.from === sessionId || grant.to === sessionId)) {
      try { auth.revokeGrant(grant.from, grant.to) } catch { /* best effort */ }
    }
    for (const request of requests.list()) {
      if (request.requester !== sessionId && request.supervisor !== sessionId) continue
      if (request.status !== 'pending' && request.status !== 'accepted') continue
      try {
        requests.cancel(request.id, request.requester)
        clearRequestTimer(request.id)
        clearExecutionTimer(request.id)
        if (request.taskId !== null) {
          cancelBoundTask(tasks, request.taskId, worker => releaseDeliverySandbox(worker, deliveryRoot(request.taskId)))
        }
      } catch { /* best effort */ }
    }
    for (const subtask of tasks.listForWorker(sessionId)) {
      if (['done', 'failed', 'cancelled'].includes(subtask.status)) continue
      try { tasks.cancel(subtask.id) } catch { /* best effort */ }
    }
    for (const task of tasks.listTasks(sessionId)) {
      if (task.status !== 'open') continue
      try { cancelBoundTask(tasks, task.id, worker => releaseDeliverySandbox(worker, deliveryRoot(task.id))) } catch { /* best effort */ }
    }
    if (eventName === 'session.archived') {
      const entry = registry.get(sessionId)
      if (entry !== undefined) {
        try { registry.upsert({ ...entry, archived: true }) } catch { /* best effort */ }
      }
    } else {
      try { registry.remove(sessionId) } catch { /* best effort */ }
    }
    collabSessions.delete(sessionId)
    try { audit.append(eventName, { sessionId }) } catch { /* best effort */ }
  }

  ctx.on('workspace/session-archived', (request) => {
    try { cleanupArchivedSession(request?.sessionId) } catch (error) { warn(`could not clean archived session ${String(request?.sessionId)}: ${describeError(error)}`) }
  })

  ctx.on('workspace/session-unarchiving', (request) => {
    const sessionId = request?.sessionId
    if (!isSessionId(sessionId)) return
    restoreCollabRegistry(sessionId)
  })

  ctx.on('api-session/added', (summary) => {
    const sessionId = summary?.sessionId
    if (!isSessionId(sessionId)) return
    const archived = archivedSessionIds()
    if (archived !== undefined && !archived.has(sessionId)) restoreCollabRegistry(sessionId)
  })

  ctx.on('api-session/added', () => { void sessionDirectory.hydrate() })

  ctx.on('api-session/removed', (sessionId) => {
    const workspaces = ctx.get('workspaceRegistry')
    if (workspaces === undefined) return
    let known
    try { known = new Set(workspaces.list().flatMap(workspace => workspace.sessionIds)) } catch { return }
    if (known.size === 0 || known.has(sessionId)) return
    try { cleanupArchivedSession(sessionId, 'session.removed') } catch (error) { warn(`could not clean removed session ${String(sessionId)}: ${describeError(error)}`) }
  })

  let reconciledCollabRegistry = false
  const archivedSessionIds = () => {
    const domain = ctx.get('storageDomain')?.get?.('workspace')
    try {
      const global = domain?.global?.get?.()
      if (Array.isArray(global?.archivedSessionIds)) return new Set(global.archivedSessionIds)
    } catch { /* diagnostic surface unavailable */ }
    return undefined
  }
  const restoreCollabRegistry = (sessionId) => {
    let entry = registry.get(sessionId)
    if (entry === undefined) {
      try { refreshRegistry() } catch { /* best effort */ }
      entry = registry.get(sessionId)
    }
    if (entry === undefined) return
    if (entry.archived === true) {
      try { registry.upsert({ ...entry, archived: false }) } catch { /* best effort */ }
    }
  }
  const syncArchivedFlags = () => {
    const archived = archivedSessionIds()
    if (archived === undefined) return
    for (const entry of registry.list()) {
      if (archived.has(entry.sessionId) && entry.archived !== true) {
        try { cleanupArchivedSession(entry.sessionId, 'session.archived') } catch { /* best effort */ }
      } else if (!archived.has(entry.sessionId) && entry.archived === true) {
        restoreCollabRegistry(entry.sessionId)
      }
    }
  }

  const reconcileCollabRegistry = (currentSessionId) => {
    if (reconciledCollabRegistry) return
    const workspaces = ctx.get('workspaceRegistry')
    if (workspaces === undefined) return
    let known
    try { known = new Set(workspaces.list().flatMap(workspace => workspace.sessionIds)) } catch { return }
    const archived = archivedSessionIds()
    if (known.size === 0 && archived === undefined) return
    reconciledCollabRegistry = true
    for (const entry of registry.list()) {
      if (entry.sessionId === currentSessionId) continue
      if (collabSessions.has(entry.sessionId) || ctx.agents.get(entry.sessionId) !== undefined) continue
      if (archived?.has(entry.sessionId) === true) {
        try { cleanupArchivedSession(entry.sessionId, 'session.archived') } catch { /* best effort */ }
        continue
      }
      if (archived !== undefined && entry.archived === true) restoreCollabRegistry(entry.sessionId)
      if (known.size > 0 && !known.has(entry.sessionId)) {
        try { cleanupArchivedSession(entry.sessionId, 'session.orphaned') } catch { /* best effort */ }
      }
    }
  }

  ctx.on('agent/created', async ({ agent }) => {
    await setupAgent(agent)
    reconcileCollabRegistry(agent.id)
    void sessionDirectory.hydrate()
  })
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
