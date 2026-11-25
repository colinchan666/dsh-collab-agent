/** Cancel every remaining subtask of a task and close it. */
export function cancelBoundTask(tasks, taskId, releaseWorker = () => {}) {
  const subtasks = tasks.listSubtasksForTask(taskId)
  for (const subtask of subtasks) {
    if (!['done', 'cancelled'].includes(subtask.status)) {
      try { tasks.cancel(subtask.id) } catch { /* best effort after request cancellation */ }
    }
    if (subtask.worker !== null) releaseWorker(subtask.worker)
  }
  try { return tasks.closeTask(taskId) } catch { return undefined }
}
