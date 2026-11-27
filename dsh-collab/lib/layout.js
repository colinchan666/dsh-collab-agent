/**
 * Filesystem protocol for collaboration sessions.
 *
 * Every collaboration session keeps its Workspace and uses one per-session
 * working directory inside it:
 *
 *   <workspace>/.dsh-collab/sessions/<sessionId>/
 *     comm/<peerSessionId>/credential.json          shared secret for this pair
 *     comm/<peerSessionId>/inbox/*.json             unread inbound messages
 *     comm/<peerSessionId>/outbox/*.json            messages this session sent
 *     comm/<peerSessionId>/archive/inbox/*.json     read inbound messages
 *     comm/<peerSessionId>/archive/outbox/*.json    explicitly archived sent messages
 *     comm/<peerSessionId>/rejected/                quarantined invalid messages
 *     private/                                      session-only data
 *
 * `comm` is the deliberately shared boundary; `private` must stay unreadable
 * from every other session. The helpers here are pure Node code so they can be
 * unit-tested without a running Harness.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Directory names that mark a collaboration workspace. */
export const SUBDIR = '.dsh-collab'

/** Maximum message body accepted by either side. */
export const MAX_MESSAGE_BYTES = 64 * 1024

/** Maximum stored inbox file read by the receiver. */
const MAX_STORED_MESSAGE_BYTES = 256 * 1024

/** Maximum number of inbox files considered per pair in one read. */
const MAX_INBOX_FILES = 200

/** Maximum message ids retained by the per-session replay ledger. */
const MAX_SEEN_IDS = 5000

/** Session ids become directory names, so accept only one safe path segment. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** Structural spelling of one collaboration session work directory. */
const SESSION_STRUCTURE = /(?:^|[\\/])\.dsh-collab[\\/]sessions[\\/]([^\\/]+)(?:[\\/]|$)/i

/** Default location of the derived session registry. */
export function defaultRegistryPath() {
  const configured = process.env.DSH_HOME
  const home = typeof configured === 'string' && configured.trim().length > 0
    ? configured.trim()
    : path.join(os.homedir(), '.dsh')
  return path.join(home, 'collab', 'registry.json')
}

/** Whether a value is a safe, DSH-shaped session id. */
export function isSessionId(value) {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value)
}

/** Recursively create a directory and enforce its mode where the platform allows it. */
export function mkdirp(directory, mode = 0o700) {
  fs.mkdirSync(directory, { recursive: true, mode })
  try { fs.chmodSync(directory, mode) } catch { /* platform without POSIX modes */ }
}

/** Cheap identity of one state file, used to invalidate parsed caches. */
export function fileStamp(file) {
  try {
    const stat = fs.statSync(file)
    return `${stat.ino}:${String(stat.size)}:${String(stat.mtimeMs)}`
  } catch {
    return 'missing'
  }
}

/**
 * Read a durable state document. A malformed document is moved aside so a
 * later write cannot silently replace evidence of corruption with an empty store.
 */
export function readStateJson(file) {
  if (!fs.existsSync(file)) return undefined
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    const backup = `${file}.corrupt-${Date.now()}`
    try { fs.renameSync(file, backup) } catch { /* preserve the original path if the backup fails */ }
    const failure = new Error(`collaboration state is corrupted: ${file}; backup: ${backup}`)
    failure.code = 'STATE_CORRUPT'
    failure.cause = error
    throw failure
  }
}

/** Whether a path is an existing directory. */
export function isDirectory(target) {
  try { return fs.statSync(target).isDirectory() } catch { return false }
}

/** Read JSON, returning undefined for a missing or malformed file. */
export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return undefined }
}

/** Create one JSON file exclusively; an existing file is never replaced. */
function writeJsonExclusive(file, value, mode = 0o600) {
  mkdirp(path.dirname(file), 0o700)
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode })
}

/** Atomically write one JSON file with owner-only permissions. */
export function writeJson(file, value, mode = 0o600) {
  mkdirp(path.dirname(file), 0o700)
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  const descriptor = fs.openSync(temporary, 'w', mode)
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8' })
    try { fs.fsyncSync(descriptor) } catch { /* filesystems without fsync support */ }
  } finally {
    fs.closeSync(descriptor)
  }
  fs.renameSync(temporary, file)
  try { fs.chmodSync(file, mode) } catch { /* platform without POSIX modes */ }
}

/** The collaboration working directory for one session. */
export function sessionWorkdir(originalCwd, sessionId) {
  if (!isSessionId(sessionId)) throw new Error(`invalid collaboration session id: ${String(sessionId)}`)
  return path.join(originalCwd, SUBDIR, 'sessions', sessionId)
}

/** The workspace base above `<base>/.dsh-collab/sessions/<dir>`, when there is one. */
export function collabBaseOf(workdir) {
  const resolved = path.resolve(workdir)
  const match = /^(.*)[\\/]\.dsh-collab[\\/]sessions[\\/][^\\/]+$/i.exec(resolved)
  return match === null ? undefined : match[1]
}

/** Whether a directory is already a dedicated collaboration workspace directory. */
export function isDedicatedCollabWorkdir(workdir) {
  return typeof workdir === 'string' && collabBaseOf(workdir) !== undefined
}

/**
 * Create or repair the `comm` and `private` layout at one exact directory.
 * @returns the layout, including the private metadata record.
 */
export function ensureLayoutAt({ workdir, originalCwd = workdir, sessionId, preset, now = Date.now() }) {
  const resolvedWorkdir = path.resolve(workdir)
  const commDir = path.join(resolvedWorkdir, 'comm')
  const privateDir = path.join(resolvedWorkdir, 'private')
  mkdirp(resolvedWorkdir, 0o700)
  mkdirp(commDir, 0o700)
  mkdirp(privateDir, 0o700)
  // Keep the marker out of `git status` of the workspace that contains it.
  const base = collabBaseOf(resolvedWorkdir) ?? path.resolve(originalCwd)
  const ignoreFile = path.join(base, SUBDIR, '.gitignore')
  if (!fs.existsSync(ignoreFile)) {
    mkdirp(path.dirname(ignoreFile), 0o700)
    fs.writeFileSync(ignoreFile, '*\n', { mode: 0o600 })
  }
  const metaFile = path.join(resolvedWorkdir, 'session.json')
  const existing = readJson(metaFile)
  const created = existing === undefined || existing.sessionId !== sessionId
  const meta = !created
    ? { ...existing, preset, updatedAt: now }
    : {
        version: 1,
        sessionId,
        preset,
        originalCwd: path.resolve(originalCwd),
        workdir: resolvedWorkdir,
        createdAt: now,
        updatedAt: now,
      }
  writeJson(metaFile, meta, 0o600)
  const readmeFile = path.join(privateDir, 'README.md')
  if (!fs.existsSync(readmeFile)) {
    fs.writeFileSync(
      readmeFile,
      [
        '# Private directory',
        '',
        'Only this session may read or write this directory.',
        'Other sessions are denied by the collaboration tool guard; the directory is also mode 0700.',
        '',
      ].join('\n'),
      { mode: 0o600 },
    )
  }
  return { workdir: resolvedWorkdir, commDir, privateDir, meta, created }
}

/**
 * Create or repair the nested layout used when a collab session runs inside a
 * project workspace: `<originalCwd>/.dsh-collab/sessions/<sessionId>/`.
 */
export function ensureSessionLayout({ originalCwd, sessionId, preset, now = Date.now() }) {
  return ensureLayoutAt({
    workdir: sessionWorkdir(originalCwd, sessionId),
    originalCwd,
    sessionId,
    preset,
    now,
  })
}

/** Bounded lock wait; the default is intentionally short because the wait blocks the event loop. */
const lockDefaults = { timeoutMs: 1000, staleMs: 10000 }

/** Override the bounded lock defaults for this Host process. */
export function configureFileLocks({ timeoutMs, staleMs } = {}) {
  if (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0) lockDefaults.timeoutMs = Math.max(1, Number(timeoutMs))
  if (Number.isFinite(Number(staleMs)) && Number(staleMs) > 0) lockDefaults.staleMs = Math.max(1, Number(staleMs))
}

/** Acquire a short-lived cross-process lock for one state document. */
export function withFileLock(file, operation, options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Math.max(1, Number(options.timeoutMs)) : lockDefaults.timeoutMs
  const staleMs = Number.isFinite(Number(options.staleMs)) ? Math.max(1, Number(options.staleMs)) : lockDefaults.staleMs
  const lock = `${file}.lock`
  const started = Date.now()
  mkdirp(path.dirname(file), 0o700)
  while (true) {
    try {
      const descriptor = fs.openSync(lock, 'wx', 0o600)
      try { fs.writeFileSync(descriptor, `${String(process.pid)}\n`) } finally { fs.closeSync(descriptor) }
      break
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      try {
        const age = Date.now() - fs.statSync(lock).mtimeMs
        if (age > staleMs) fs.unlinkSync(lock)
      } catch { /* the owner may have removed it */ }
      if (Date.now() - started > timeoutMs) {
        let holder = 'unknown'
        try { holder = fs.readFileSync(lock, 'utf8').trim() || holder } catch { /* lock vanished */ }
        throw new Error(`timed out after ${String(timeoutMs)}ms waiting for state lock: ${lock} (holder pid ${holder})`)
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    }
  }
  try {
    return operation()
  } finally {
    try { fs.unlinkSync(lock) } catch { /* already removed */ }
  }
}

/** Durable, derived index of collaboration sessions. */
export class SessionRegistry {
  constructor(file) {
    this.file = file
    this.state = undefined
  }

  read() {
    const stamp = fileStamp(this.file)
    if (this.state !== undefined && this.stamp === stamp) return this.state
    const raw = readStateJson(this.file)
    const sessions = raw !== null && typeof raw === 'object' && raw.sessions !== null && typeof raw.sessions === 'object'
      ? raw.sessions
      : {}
    this.state = { version: 1, sessions, ignored: Array.isArray(raw?.ignored) ? raw.ignored : [] }
    this.stamp = stamp
    return this.state
  }

  write(state) {
    this.state = state
    writeJson(this.file, { version: 1, sessions: state.sessions, ignored: state.ignored ?? [] })
    this.stamp = fileStamp(this.file)
  }

  get(sessionId) {
    return this.read().sessions[sessionId]
  }

  list() {
    return Object.values(this.read().sessions)
      .filter(entry => entry !== null && typeof entry === 'object' && isSessionId(entry.sessionId))
      .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0))
  }

  upsert(entry) {
    if (!isSessionId(entry.sessionId)) return
    withFileLock(this.file, () => {
      this.state = undefined
      const state = this.read()
      state.sessions[entry.sessionId] = { ...state.sessions[entry.sessionId], ...entry }
      state.ignored = (state.ignored ?? []).filter(id => id !== entry.sessionId)
      this.write(state)
    })
  }

  ignore(sessionIds) {
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) return
    withFileLock(this.file, () => {
      this.state = undefined
      const state = this.read()
      state.ignored = [...new Set([...(state.ignored ?? []), ...sessionIds])]
      this.write(state)
    })
  }

  remove(sessionId) {
    withFileLock(this.file, () => {
      this.state = undefined
      const state = this.read()
      if (state.sessions[sessionId] === undefined) return
      delete state.sessions[sessionId]
      this.write(state)
    })
  }

  /** Merge sessions discovered under registered workspace directories. */
  scanWorkspaces(workspacePaths) {
    return withFileLock(this.file, () => {
    this.state = undefined
    const state = this.read()
    let discovered = 0
    let changed = false
    for (const workspacePath of workspacePaths) {
      const sessionsDir = path.join(workspacePath, SUBDIR, 'sessions')
      let entries
      try { entries = fs.readdirSync(sessionsDir, { withFileTypes: true }) } catch { continue }
      const discoveredIds = new Set()
      for (const entry of entries) {
        if (!entry.isDirectory() || !isSessionId(entry.name)) continue
        if ((state.ignored ?? []).includes(entry.name)) continue
        const workdir = path.join(sessionsDir, entry.name)
        const meta = readJson(path.join(workdir, 'session.json'))
        if (meta === undefined || meta.sessionId !== entry.name) continue
        if (meta.preset !== 'collab' && meta.preset !== 'supervisor') continue
        discoveredIds.add(entry.name)
        const existing = state.sessions[entry.name]
        if (existing === undefined) {
          state.sessions[entry.name] = {
            sessionId: entry.name,
            workdir,
            originalCwd: meta.originalCwd,
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
          }
          discovered += 1
          changed = true
          continue
        }
        // A moved workspace or a changed preset must repair the derived entry,
        // while preserving the live title maintained by session events.
        const next = {
          ...existing,
          originalCwd: typeof meta.originalCwd === 'string' ? meta.originalCwd : existing.originalCwd,
          workdir,
          updatedAt: typeof meta.updatedAt === 'number' ? meta.updatedAt : existing.updatedAt,
        }
        if (next.originalCwd !== existing.originalCwd || next.workdir !== existing.workdir) {
          state.sessions[entry.name] = next
          changed = true
        }
      }
      for (const [id, entry] of Object.entries(state.sessions)) {
        if (typeof entry?.workdir !== 'string') continue
        if (path.dirname(entry.workdir) !== sessionsDir) continue
        if (discoveredIds.has(id)) continue
        delete state.sessions[id]
        changed = true
      }
    }
    if (changed) this.write(state)
    return discovered
    })
  }
}

/** Path of one peer's credential inside a session's `comm` directory. */
export function credentialPath(workdir, peerSessionId) {
  if (!isSessionId(peerSessionId)) throw new Error(`invalid peer session id: ${String(peerSessionId)}`)
  return path.join(workdir, 'comm', peerSessionId, 'credential.json')
}

/**
 * Ensure both sides of a pair hold the same shared secret.
 * The first caller generates it; later callers adopt the existing value.
 */
function ensureCredentialUnlocked({ selfId, selfWorkdir, peerId, peerWorkdir, now = Date.now() }) {
  if (!isSessionId(selfId) || !isSessionId(peerId)) throw new Error('invalid collaboration session id')
  if (selfId === peerId) throw new Error('a session cannot talk to itself')
  if (selfWorkdir === peerWorkdir) throw new Error('peer work directories must differ')
  const ownFile = credentialPath(selfWorkdir, peerId)
  const peerFile = credentialPath(peerWorkdir, selfId)
  const own = readJson(ownFile)
  const peer = readJson(peerFile)
  if (typeof own?.token === 'string' && typeof peer?.token === 'string' && own.token !== peer.token) {
    throw new Error(`credential mismatch for ${selfId} <-> ${peerId}; refusing to overwrite either copy`)
  }
  let token = typeof own?.token === 'string' && own.token.length > 0
    ? own.token
    : (typeof peer?.token === 'string' && peer.token.length > 0 ? peer.token : undefined)
  if (token === undefined) token = crypto.randomBytes(32).toString('hex')
  const ownRecord = {
    version: 1,
    ownerSessionId: selfId,
    peerSessionId: peerId,
    token,
    createdAt: typeof own?.createdAt === 'number' ? own.createdAt : now,
    updatedAt: now,
  }
  if (own?.token !== token) {
    try {
      writeJsonExclusive(ownFile, ownRecord)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const adopted = readJson(ownFile)
      if (typeof adopted?.token !== 'string' || adopted.token.length === 0) {
        throw new Error(`credential for ${selfId} <-> ${peerId} could not be created or adopted`)
      }
      token = adopted.token
      if (typeof peer?.token === 'string' && peer.token !== token) {
        throw new Error(`credential mismatch for ${selfId} <-> ${peerId}; refusing to overwrite either copy`)
      }
    }
  }
  if (peer?.token !== token) {
    const peerRecord = {
      version: 1,
      ownerSessionId: peerId,
      peerSessionId: selfId,
      token,
      createdAt: typeof peer?.createdAt === 'number' ? peer.createdAt : now,
      updatedAt: now,
    }
    try {
      writeJsonExclusive(peerFile, peerRecord)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const adopted = readJson(peerFile)
      if (adopted?.token !== token) {
        throw new Error(`credential mismatch for ${selfId} <-> ${peerId}; refusing to overwrite either copy`)
      }
    }
  }
  return token
}

/**
 * Serialize the first-contact credential write for both directions of a pair.
 * Both sides acquire the same pair of lock files in lexicographic order.
 */
export function ensureCredential(args) {
  const { selfId, selfWorkdir, peerId, peerWorkdir } = args
  const locks = [
    credentialPath(selfWorkdir, peerId),
    credentialPath(peerWorkdir, selfId),
  ].sort()
  return withFileLock(locks[0], () => withFileLock(locks[1], () => ensureCredentialUnlocked(args)))
}

const MESSAGE_KINDS = new Set(['chat', 'request', 'task'])

function macInput(message) {
  if (typeof message.kind === 'string') {
    return `${message.id}\n${message.from}\n${message.to}\n${message.createdAt}\n${message.kind}\n${message.text}`
  }
  return `${message.id}\n${message.from}\n${message.to}\n${message.createdAt}\n${message.text}`
}

/** Authenticate one message with its pair secret. */
export function signMessage(token, message) {
  return crypto.createHmac('sha256', token).update(macInput(message)).digest('hex')
}

function verifyMessage(token, message, peerId, selfId) {
  if (typeof token !== 'string' || token.length === 0) return false
  if (message === null || typeof message !== 'object') return false
  if (typeof message.id !== 'string' || message.id.length === 0 || message.id.length > 128) return false
  if (message.from !== peerId || message.to !== selfId) return false
  if (typeof message.text !== 'string' || message.text.length === 0) return false
  if (message.kind !== undefined && !MESSAGE_KINDS.has(message.kind)) return false
  if (typeof message.createdAt !== 'number' || !Number.isFinite(message.createdAt)) return false
  if (typeof message.mac !== 'string' || message.mac.length !== 64) return false
  const expected = Buffer.from(signMessage(token, message), 'hex')
  const actual = Buffer.from(message.mac, 'hex')
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}

function quarantine(file, workdir, peerId) {
  try {
    const targetDir = path.join(workdir, 'comm', peerId, 'rejected')
    mkdirp(targetDir, 0o700)
    let target = path.join(targetDir, path.basename(file))
    if (fs.existsSync(target)) target = `${target}.${crypto.randomBytes(3).toString('hex')}`
    fs.renameSync(file, target)
  } catch {
    // Best effort: a file that cannot be quarantined is simply skipped.
  }
}

/** Move every regular file from one directory into another, then remove the empty source. */
function moveFiles(fromDir, toDir) {
  let entries
  try { entries = fs.readdirSync(fromDir, { withFileTypes: true }) } catch { return }
  if (entries.length === 0) {
    try { fs.rmdirSync(fromDir) } catch { /* best effort */ }
    return
  }
  mkdirp(toDir, 0o700)
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const source = path.join(fromDir, entry.name)
    let target = path.join(toDir, entry.name)
    if (fs.existsSync(target)) target = `${target}.${crypto.randomBytes(3).toString('hex')}`
    try { fs.renameSync(source, target) } catch { /* leave the file for a later retry */ }
  }
  try { fs.rmdirSync(fromDir) } catch { /* non-empty leftovers stay in place */ }
}

/**
 * Migrate the legacy `read/` directory into `archive/inbox/`. Normal
 * `outbox/` messages stay in place; an `archive/outbox/` present from the
 * earlier bulk migration is restored to `outbox/` so sent messages are not
 * silently archived.
 */
function migratePairLayout(pairDir) {
  const archive = path.join(pairDir, 'archive')
  if (fs.existsSync(path.join(pairDir, 'read'))) moveFiles(path.join(pairDir, 'read'), path.join(archive, 'inbox'))
  const archivedOutbox = path.join(archive, 'outbox')
  if (fs.existsSync(archivedOutbox)) moveFiles(archivedOutbox, path.join(pairDir, 'outbox'))
}

/**
 * Write one authenticated message into both sessions' pair directories.
 * The sender keeps the outbox copy; the receiver gets the inbox copy.
 */
export function sendMessage({ selfId, selfWorkdir, peerId, peerWorkdir, kind = 'chat', text, now = Date.now() }) {
  if (typeof text !== 'string' || text.trim().length === 0) throw new Error('message text must not be empty')
  if (Buffer.byteLength(text) > MAX_MESSAGE_BYTES) throw new Error('message is larger than 64 KiB')
  if (!MESSAGE_KINDS.has(kind)) throw new Error(`invalid message kind: ${String(kind)}`)
  const token = ensureCredential({ selfId, selfWorkdir, peerId, peerWorkdir, now })
  const message = {
    version: 1,
    id: crypto.randomUUID(),
    from: selfId,
    to: peerId,
    kind,
    createdAt: now,
    text,
  }
  message.mac = signMessage(token, message)
  const fileName = `${String(now).padStart(13, '0')}-${message.id}.json`
  const selfPairDir = path.join(selfWorkdir, 'comm', peerId)
  migratePairLayout(selfPairDir)
  writeJson(path.join(selfPairDir, 'outbox', fileName), message)
  writeJson(path.join(peerWorkdir, 'comm', selfId, 'inbox', fileName), message)
  return message
}

/** Count files waiting in one pair's inbox. */
export function inboxCount(workdir, peerId) {
  const inbox = path.join(workdir, 'comm', peerId, 'inbox')
  try {
    return fs.readdirSync(inbox).filter(name => name.endsWith('.json')).length
  } catch {
    return 0
  }
}

/**
 * Read every authenticated inbox message for one session.
 * @returns accepted messages with their files, plus a count of rejected files.
 */
export function listInbox({ selfId, selfWorkdir }) {
  const commDir = path.join(selfWorkdir, 'comm')
  let pairs
  try { pairs = fs.readdirSync(commDir, { withFileTypes: true }) } catch { return { messages: [], rejected: 0, truncated: 0 } }
  const messages = []
  let rejected = 0
  let truncated = 0
  const seenRaw = readJson(path.join(commDir, '.seen.json'))
  const seen = new Set(Array.isArray(seenRaw?.ids) ? seenRaw.ids.filter(id => typeof id === 'string') : [])
  for (const pair of pairs) {
    if (!pair.isDirectory() || !isSessionId(pair.name) || pair.name === selfId) continue
    const peerId = pair.name
    const pairDir = path.join(commDir, peerId)
    migratePairLayout(pairDir)
    const credential = readJson(credentialPath(selfWorkdir, peerId))
    const inbox = path.join(pairDir, 'inbox')
    let files
    try { files = fs.readdirSync(inbox) } catch { continue }
    const jsonFiles = files.filter(fileName => fileName.endsWith('.json')).sort()
    if (jsonFiles.length > MAX_INBOX_FILES) truncated += jsonFiles.length - MAX_INBOX_FILES
    for (const fileName of jsonFiles.slice(0, MAX_INBOX_FILES)) {
      const file = path.join(inbox, fileName)
      let size = 0
      try { size = fs.statSync(file).size } catch { continue }
      if (size > MAX_STORED_MESSAGE_BYTES) {
        quarantine(file, selfWorkdir, peerId)
        rejected += 1
        continue
      }
      const message = readJson(file)
      if (!verifyMessage(credential?.token, message, peerId, selfId)) {
        quarantine(file, selfWorkdir, peerId)
        rejected += 1
        continue
      }
      if (seen.has(message.id)) {
        quarantine(file, selfWorkdir, peerId)
        rejected += 1
        continue
      }
      messages.push({ file, peerId, message })
    }
  }
  messages.sort((left, right) => left.message.createdAt - right.message.createdAt || left.message.id.localeCompare(right.message.id))
  return { messages, rejected, truncated }
}

/** Move one read inbox message to its pair's `archive/inbox/` directory. */
/** Migrate every pair directory of one session into the archive split. */
export function migrateSessionArchive(workdir) {
  const commDir = path.join(workdir, 'comm')
  let pairs
  try { pairs = fs.readdirSync(commDir, { withFileTypes: true }) } catch { return }
  for (const pair of pairs) {
    if (!pair.isDirectory() || !isSessionId(pair.name)) continue
    migratePairLayout(path.join(commDir, pair.name))
  }
}

/** Move one read inbox message to its pair's `archive/inbox/` directory. */
export function markRead(file, workdir) {
  const pairDir = path.dirname(path.dirname(file))
  migratePairLayout(pairDir)
  const message = readJson(file)
  const archiveDir = path.join(pairDir, 'archive', 'inbox')
  mkdirp(archiveDir, 0o700)
  let target = path.join(archiveDir, path.basename(file))
  if (fs.existsSync(target)) target = `${target}.${crypto.randomBytes(3).toString('hex')}`
  fs.renameSync(file, target)
  if (typeof message?.id === 'string' && message.id.length > 0) {
    const seenFile = path.join(path.dirname(pairDir), '.seen.json')
    try {
      withFileLock(seenFile, () => {
        const raw = readJson(seenFile)
        const seen = new Set(Array.isArray(raw?.ids) ? raw.ids.filter(id => typeof id === 'string') : [])
        seen.add(message.id)
        writeJson(seenFile, { version: 1, ids: [...seen].slice(-MAX_SEEN_IDS) }, 0o600)
      })
    } catch { /* a ledger failure must not prevent acknowledging the message */ }
  }
  return target
}

function comparablePath(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isInside(candidate, root) {
  const resolvedCandidate = comparablePath(candidate)
  const resolvedRoot = comparablePath(root)
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
}

/** Shell-ish path tokens used to inspect a bash command. */
export function bashPathCandidates(command) {
  const tokens = []
  const pattern = /"([^"]*)"|'([^']*)'|([^\s;&|<>()`]+)/g
  let match
  while ((match = pattern.exec(command)) !== null) {
    let token = match[1] ?? match[2] ?? match[3]
    if (token === undefined || token.length === 0) continue
    if (token.startsWith('-')) continue
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) token = token.slice(token.indexOf('=') + 1)
    if (token.length === 0) continue
    if (token.includes('/') || token.includes('\\') || token === '..' || token === '~' || token.startsWith('~/')) {
      tokens.push(token)
    }
  }
  return tokens
}

function expandToken(token, selfWorkdir) {
  if (token === '~') return os.homedir()
  if (token.startsWith('~/')) return path.join(os.homedir(), token.slice(2))
  return path.resolve(selfWorkdir, token)
}

/** Resolve symlinks for an existing path, or for the existing parent of a new one. */
export function canonicalPath(target) {
  const resolved = path.resolve(target)
  try { return fs.realpathSync.native(resolved) } catch { /* not existing */ }
  try {
    return path.join(fs.realpathSync.native(path.dirname(resolved)), path.basename(resolved))
  } catch {
    return resolved
  }
}

/**
 * Detect an attempt to touch another session's work directory (comm or private).
 * @returns the offending peer id and input, or undefined.
 */
export function findForeignSessionAccess(values, { selfId, selfWorkdir, selfLayoutWorkdir, roots = [] }) {
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 8192) continue
    const resolved = expandToken(value, selfWorkdir)
    const canonical = canonicalPath(resolved)
    // A wildcard segment under the shared sessions directory can expand into
    // every peer's private/comm, so it is not a harmless literal. Allow only
    // wildcards whose literal prefix stays inside this session's own layout.
    if (/[*?[\]]/.test(value) && (/\.dsh-collab[\\/]sessions[\\/]/i.test(value) || /\.dsh-collab[\\/]sessions[\\/]/i.test(canonical))) {
      const literalPrefix = value.split(/[*?[\]]/)[0]
      const resolvedPrefix = expandToken(literalPrefix, selfWorkdir)
      const canonicalPrefix = canonicalPath(resolvedPrefix)
      const ownLayout = selfLayoutWorkdir ?? selfWorkdir
      const canonicalOwnLayout = canonicalPath(ownLayout)
      if (!isInside(resolvedPrefix, ownLayout) && !isInside(canonicalPrefix, canonicalOwnLayout)) {
        return { sessionId: '<wildcard>', value }
      }
    }
    // The caller's own layout is never foreign, even when its directory name is
    // a generated token rather than the session id.
    if (typeof selfLayoutWorkdir === 'string') {
      const canonicalLayout = canonicalPath(selfLayoutWorkdir)
      if (
        isInside(resolved, selfLayoutWorkdir)
        || isInside(canonical, selfLayoutWorkdir)
        || isInside(canonical, canonicalLayout)
      ) {
        continue
      }
    }
    // Script bodies and quoted prose can mention a path without being one.
    // Wildcard segments are left to the pattern check, which gives a clearer
    // denial than treating `*` as a session id.
    const concrete = segment => segment !== undefined && !/[*?[\]]/.test(segment)
    if (!/[\s<>]/.test(value)) {
      const structural = SESSION_STRUCTURE.exec(value)
      if (structural !== null && concrete(structural[1]) && structural[1] !== selfId) {
        return { sessionId: structural[1], value }
      }
      const canonicalStructural = SESSION_STRUCTURE.exec(canonical)
      if (canonicalStructural !== null && concrete(canonicalStructural[1]) && canonicalStructural[1] !== selfId) {
        return { sessionId: canonicalStructural[1], value }
      }
    }
    for (const root of roots) {
      if (root.sessionId === selfId) continue
      const canonicalRoot = canonicalPath(root.workdir)
      if (
        isInside(resolved, root.workdir)
        || isInside(resolved, canonicalRoot)
        || isInside(canonical, root.workdir)
        || isInside(canonical, canonicalRoot)
      ) {
        return { sessionId: root.sessionId, value }
      }
    }
  }
  return undefined
}

function isStrictAncestor(candidate, child) {
  const resolvedCandidate = comparablePath(candidate)
  const resolvedChild = comparablePath(child)
  return resolvedChild.startsWith(`${resolvedCandidate}${path.sep}`)
}

/**
 * Detect a directory whose recursive search would include another session's
 * work directory. Such a root is refused for search and shell execution.
 */
export function findForeignAncestorAccess(values, { selfId, selfWorkdir, roots = [] }) {
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 8192) continue
    const resolved = expandToken(value, selfWorkdir)
    const canonical = canonicalPath(resolved)
    for (const root of roots) {
      if (root.sessionId === selfId) continue
      const canonicalRoot = canonicalPath(root.workdir)
      if (isStrictAncestor(resolved, root.workdir) || isStrictAncestor(canonical, canonicalRoot)) {
        return { sessionId: root.sessionId, value }
      }
    }
  }
  return undefined
}


/** Discover sibling session work directories next to one session's layout. */
export function discoverSiblingWorkdirs(workdir) {
  const resolved = path.resolve(workdir)
  const marker = `${path.sep}${SUBDIR}${path.sep}sessions${path.sep}`
  const index = resolved.lastIndexOf(marker)
  if (index < 0) return []
  const base = resolved.slice(0, index + marker.length - 1)
  let entries
  try { entries = fs.readdirSync(base, { withFileTypes: true }) } catch { return [] }
  const siblings = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSessionId(entry.name)) continue
    siblings.push({ sessionId: entry.name, workdir: path.join(base, entry.name) })
  }
  return siblings
}

/** Detect a glob pattern that could expand into another session's work directory. */
export function findSuspiciousSearchPattern(value, { selfId, roots = [] }) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) return undefined
  // A path pattern, not a code blob or prose that happens to contain `..`.
  if (!/[\\/]/.test(value)) return undefined
  if (/[.*?[]/.test(value) && /\.\./.test(value) && /(private|comm|\.dsh-collab)/i.test(value)) {
    return { sessionId: '<pattern>', value }
  }
  return undefined
}

/** Inspect a shell command, including `cd`-then-relative forms. */
export function findForeignSessionAccessInCommand(command, options) {
  const tokens = bashPathCandidates(command)
  const hit = findForeignSessionAccess(tokens, options)
  if (hit !== undefined) return hit
  if (options.checkAncestors !== false) {
    const ancestor = findForeignAncestorAccess(tokens, options)
    if (ancestor !== undefined) return ancestor
  }
  for (const token of tokens) {
    if (/[\s<>]/.test(token) || !/[\\/]/.test(token)) continue
    const suspicious = findSuspiciousSearchPattern(token, options)
    if (suspicious !== undefined) return suspicious
  }
  const mentionsPrivate = /\bprivate\b/i.test(command)
  if (!mentionsPrivate) return undefined
  const foreign = options.roots.find(root => root.sessionId !== options.selfId && command.includes(root.sessionId))
  if (foreign !== undefined) return { sessionId: foreign.sessionId, value: command }
  return undefined
}
