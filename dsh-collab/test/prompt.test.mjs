import assert from 'node:assert/strict'
import test from 'node:test'

import { promptText } from '../lib/prompt.js'

const layout = { workdir: '/tmp/collab-session', meta: {} }

test('supervisor and worker prompts expose the current task/subtask contract', () => {
  const supervisor = promptText('session-a', layout, 'supervisor', { isWorker: () => false }, ['worker-b capability="writer"'])
  assert.match(supervisor, /SUPERVISOR/u)
  assert.match(supervisor, /collab_task_open/u)
  assert.match(supervisor, /collab_subtask_create/u)
  assert.match(supervisor, /worker-b capability/u)
  const worker = promptText('session-b', layout, 'collab', { isWorker: () => true })
  assert.match(worker, /FUNCTIONAL WORKER/u)
  assert.match(worker, /collab_subtask_accept/u)
  assert.doesNotMatch(worker, /SUPERVISOR/u)
})
