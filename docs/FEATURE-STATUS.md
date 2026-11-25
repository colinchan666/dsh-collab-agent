# Collab optimization status

Branch: `feature/collab-optimizations`

## Completed

- explicit `collab_task_open` and `collab_task_list`;
- `collab_task_close` refuses active subtasks;
- request cancellation cancels bound subtasks and closes the parent task;
- ordinary sessions are excluded from worker candidates, offers, authorization
  pairs/pending grants, `/collab-auth`, and the authorization page;
- invalid grants and relationships are pruned at startup;
- complete `collab_subtask_*` aliases;
- typed Remote methods for board/base-prompt/link operations;
- audit log at `<state>/audit.jsonl`;
- read-only `collab_doctor` health snapshot;
- browser E2E for supervisor board tabs, workspace switching, and
  authorization-page preset filtering;
- extracted Host modules:
  - `presets`
  - `task-aliases`
  - `delivery-manifest`
  - `audit`
  - `cancel-request`
  - `panel-api`
  - `health`
  - `access-policy`
  - `tool-schemas`
  - `prompt`.

## Remaining

- further split task/message tool implementations out of `index.js`;
- transactional cross-file state updates;
- scheduler/deadline/retry policy;
- Windows sandbox validation;
- cleanup of supervisor sessions created by gated browser tests;
- final merge/release decision (`0.0.4`).
