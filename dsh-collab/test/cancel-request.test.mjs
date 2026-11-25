import assert from 'node:assert/strict'
import test from 'node:test'

import { cancelBoundTask } from '../lib/cancel-request.js'

test('cancelBoundTask cancels active subtasks, releases workers, and closes the task', () => {
  const calls = []
  const tasks = {
    listSubtasksForTask: () => [
      { id: 'subtask-a', status: 'running', worker: 'worker-a' },
      { id: 'subtask-b', status: 'done', worker: 'worker-b' },
      { id: 'subtask-c', status: 'created', worker: null },
    ],
    cancel: id => calls.push(['cancel', id]),
    closeTask: id => { calls.push(['close', id]); return { id, status: 'closed' } },
  }
  const released = []
  const closed = cancelBoundTask(tasks, 'task-1', worker => released.push(worker))
  assert.equal(closed.status, 'closed')
  assert.deepEqual(calls, [['cancel', 'subtask-a'], ['cancel', 'subtask-c'], ['close', 'task-1']])
  assert.deepEqual(released, ['worker-a', 'worker-b'])
})
