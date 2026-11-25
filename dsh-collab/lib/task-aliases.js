/** Build the public subtask aliases from the legacy task tool definitions. */
export function subtaskAliases(taskTools) {
  const taskTool = name => taskTools.find(tool => tool.name === name)
  return [
    {
      ...taskTool('collab_task_create'),
      name: 'collab_subtask_create',
      description: 'Create a subtask under an existing parent task.',
    },
    {
      ...taskTool('collab_task_assign'),
      name: 'collab_subtask_assign',
      description: 'Assign a subtask to a worker with an offer relationship and wake it.',
    },
    {
      ...taskTool('collab_tasks'),
      name: 'collab_subtasks',
      description: 'List subtasks for this supervisor or the subtasks assigned to the calling worker.',
    },
    {
      ...taskTool('collab_task_result'),
      name: 'collab_subtask_result',
      description: 'Read one subtask detail and result.',
    },
    {
      ...taskTool('collab_task_retry'),
      name: 'collab_subtask_retry',
      description: 'Retry a failed, cancelled, or completed subtask.',
    },
    {
      ...taskTool('collab_task_reject'),
      name: 'collab_subtask_reject',
      description: 'Reject a completed subtask and send it back to its worker.',
    },
    {
      ...taskTool('collab_task_cancel'),
      name: 'collab_subtask_cancel',
      description: 'Cancel a subtask.',
    },
    {
      ...taskTool('collab_task_accept'),
      name: 'collab_subtask_accept',
      description: 'Accept an assigned subtask and return its instructions.',
    },
    {
      ...taskTool('collab_task_progress'),
      name: 'collab_subtask_progress',
      description: 'Record progress on an accepted subtask.',
    },
    {
      ...taskTool('collab_task_complete'),
      name: 'collab_subtask_complete',
      description: 'Complete a subtask and notify its supervisor with the result.',
    },
    {
      ...taskTool('collab_task_fail'),
      name: 'collab_subtask_fail',
      description: 'Report a subtask failure to its supervisor.',
    },
  ]
}
