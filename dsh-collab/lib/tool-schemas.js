/** Model-facing tool parameter schemas. */
export const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render(_args, value) {
    return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
  },
}

export const NO_PARAMETERS = { type: 'object', properties: {}, additionalProperties: false }

export const SEND_PARAMETERS = {
  type: 'object',
  properties: {
    target: { type: 'string', description: 'Exact target session id (session-...). Use collab_peers to find it.' },
    message: { type: 'string', description: 'Message text for the target session.' },
  },
  required: ['target', 'message'],
  additionalProperties: false,
}

export const INBOX_PARAMETERS = {
  type: 'object',
  properties: {
    peer: { type: 'string', description: 'Optional peer session id to read only that pair.' },
    mark_read: { type: 'boolean', description: 'Whether to move read messages into the pair read directory. Defaults to true.' },
  },
  additionalProperties: false,
}

export const TASK_OPEN_PARAMETERS = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short parent-task title.' },
  },
  required: ['title'],
  additionalProperties: false,
}

export const TASK_CREATE_PARAMETERS = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short task title.' },
    instruction: { type: 'string', description: 'Self-contained instructions for the worker.' },
    acceptance: { type: 'string', description: 'Acceptance criteria the supervisor will verify.' },
    inputs: { type: 'object', description: 'Optional structured inputs for the worker.' },
    taskId: { type: 'string', description: 'Parent task id returned by collab_task_open.' },
  },
  required: ['taskId', 'title', 'instruction'],
  additionalProperties: false,
}

export const TASK_ASSIGN_PARAMETERS = {
  type: 'object',
  properties: {
    subtaskId: { type: 'string', description: 'Subtask id (subtask-...); taskId is accepted for legacy callers.' },
    taskId: { type: 'string', description: 'Legacy subtask id alias.' },
    worker: { type: 'string', description: 'Worker session id with an offer relationship.' },
  },
  required: ['worker'],
  additionalProperties: false,
}

export const TASK_ID_PARAMETERS = {
  type: 'object',
  properties: {
    taskId: { type: 'string', description: 'Task id (task-...).' },
  },
  required: ['taskId'],
  additionalProperties: false,
}

export const TASK_LIST_PARAMETERS = {
  type: 'object',
  properties: {
    status: { type: 'string', description: 'Optional status filter.' },
  },
  additionalProperties: false,
}

export const TASK_REJECT_PARAMETERS = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
    reason: { type: 'string', description: 'Why the delivered result is rejected.' },
  },
  required: ['taskId', 'reason'],
  additionalProperties: false,
}

export const TASK_PROGRESS_PARAMETERS = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['taskId', 'note'],
  additionalProperties: false,
}

export const TASK_COMPLETE_PARAMETERS = {
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

export const TASK_FAIL_PARAMETERS = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['taskId', 'reason'],
  additionalProperties: false,
}

export const TASK_CLOSE_PARAMETERS = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
  },
  required: ['taskId'],
  additionalProperties: false,
}

export const DELIVERY_LIST_PARAMETERS = {
  type: 'object',
  properties: {
    taskId: { type: 'string', description: 'Optional task id; omitted lists only this supervisor\'s tasks.' },
  },
  additionalProperties: false,
}

export const DELIVERY_MANIFEST_PARAMETERS = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
  },
  required: ['taskId'],
  additionalProperties: false,
}

export const REQUEST_DELIVER_PARAMETERS = {
  type: 'object',
  properties: {
    requestId: { type: 'string' },
  },
  required: ['requestId'],
  additionalProperties: false,
}


export const REQUEST_SUBMIT_PARAMETERS = {
  type: 'object',
  properties: {
    supervisor: { type: 'string', description: 'Target supervisor id. Required when more than one authorized supervisor is available.' },
    title: { type: 'string', description: 'Short request title.' },
    requirement: { type: 'string', description: 'Outcome-focused requirement and acceptance criteria. Do not name workers, projects, tasks, delivery paths, or internal scheduling.' },
  },
  required: ['title', 'requirement'],
  additionalProperties: false,
}

export const REQUEST_LIST_PARAMETERS = {
  type: 'object',
  properties: {
    status: { type: 'string', description: 'Optional status filter.' },
  },
  additionalProperties: false,
}

export const REQUEST_ACCEPT_PARAMETERS = {
  type: 'object',
  properties: {
    requestId: { type: 'string' },
    taskId: { type: 'string', description: 'Task containing the subtasks created for this request.' },
    response: { type: 'string', description: 'Optional message for the requester.' },
  },
  required: ['requestId', 'taskId'],
  additionalProperties: false,
}

export const REQUEST_REJECT_PARAMETERS = {
  type: 'object',
  properties: {
    requestId: { type: 'string' },
    reason: { type: 'string', description: 'Why the registered capabilities cannot satisfy this request; name the missing capability.' },
  },
  required: ['requestId', 'reason'],
  additionalProperties: false,
}

export const REQUEST_CANCEL_PARAMETERS = {
  type: 'object',
  properties: {
    requestId: { type: 'string' },
  },
  required: ['requestId'],
  additionalProperties: false,
}

export const REQUEST_HEARTBEAT_PARAMETERS = {
  type: 'object',
  properties: {
    requestId: { type: 'string' },
    note: { type: 'string', description: 'Optional progress note for the requester.' },
    extendByMs: { type: 'number', description: 'Optional execution deadline extension in milliseconds, capped at seven days.' },
  },
  required: ['requestId'],
  additionalProperties: false,
}
