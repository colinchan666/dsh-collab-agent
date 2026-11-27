/** Messaging, peer, and health tools. */
import { INBOX_PARAMETERS, NO_PARAMETERS, SEND_PARAMETERS, TEXT_OUTPUT } from './tool-schemas.js'
import { COLLAB_PRESETS } from './presets.js'

export function createMessageTools({
  requireSelf, infoText, peersText, refreshRegistry, registry, auth, isSessionId,
  collabSessions, MAX_MESSAGE_BYTES, sendMessage, wakePeer, credentialPath,
  inboxText, isDirectory, collectHealth, tasks, requests, relationships, audit,
  collabAdmin, isSupervisorSession, sessionDirectory,
}) {
  return [
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
        return JSON.stringify(collectHealth({
          sessionId: self.sessionId,
          registryEntries: registry.list(),
          relationships: relationships.list(),
          grants: auth.listGrants(),
          tasks: tasks.listTasks(self.sessionId),
          requests: requests.list(),
          auditEntries: collabAdmin.audit(1).length,
          isSupervisor: isSupervisorSession(self.sessionId),
        }))
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
        const targetEntry = sessionDirectory.get(targetId)
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
  ]
}
