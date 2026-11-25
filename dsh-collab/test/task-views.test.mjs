import assert from 'node:assert/strict'
import test from 'node:test'

import { taskDetail, taskLine } from '../lib/task-views.js'

test('task views keep parent and subtask identity explicit', () => {
  const task = {
    id: 'subtask-a', taskId: 'task-a', supervisor: 'session-s', worker: 'session-w',
    title: 'Write result', instruction: 'do it', inputs: {}, acceptance: 'done',
    status: 'assigned', attempts: 1, createdTurn: 2, assignedTurn: 3,
    capabilityVersion: 'v1', result: null, failure: null, history: [],
  }
  assert.match(taskLine(task), /subtask-a/u)
  assert.match(taskLine(task), /task=task-a/u)
  assert.deepEqual(
    { id: taskDetail(task).id, subtaskId: taskDetail(task).subtaskId, taskId: taskDetail(task).taskId },
    { id: 'subtask-a', subtaskId: 'subtask-a', taskId: 'task-a' },
  )
})
