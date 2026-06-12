-- Conversation tasks. A task is created from a conversation (right-click → Create task),
-- can be assigned to a teammate, has an optional due date, and toggles between
-- 'todo' and 'completed'. The task detail view reuses the conversation's SMS thread.
CREATE TABLE IF NOT EXISTS tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  title           text NOT NULL,
  description     text,
  assigned_to     uuid REFERENCES users(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'todo',   -- todo | completed
  due_date        timestamptz,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_conv      ON tasks (conversation_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee  ON tasks (assigned_to, status);

-- Let the existing notifications table point at a task (nullable).
-- notifications.type is varchar(50) with no CHECK constraint, so the new
-- 'task_assigned' type needs no further schema change.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES tasks(id) ON DELETE CASCADE;
