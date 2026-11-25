/** Compact and detailed task views shared by the Host tools. */
export function taskLine(task) {
  return `- ${task.id} [${task.status}] worker=${task.worker ?? 'unassigned'} task=${task.taskId ?? '-'} title=${JSON.stringify(task.title)}`
}

export function taskDetail(task) {
  return {
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
  }
}
