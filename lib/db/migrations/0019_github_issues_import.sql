ALTER TABLE epics ADD COLUMN github_issue_number integer;
ALTER TABLE epics ADD COLUMN github_issue_url text;
ALTER TABLE epics ADD COLUMN github_issue_state text;

CREATE TABLE IF NOT EXISTS github_issues (
  id text PRIMARY KEY NOT NULL,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE cascade,
  issue_number integer NOT NULL,
  title text NOT NULL,
  body text,
  labels text,
  milestone text,
  assignees text,
  github_url text NOT NULL,
  created_at_github text,
  updated_at_github text,
  synced_at text DEFAULT CURRENT_TIMESTAMP,
  imported_epic_id text REFERENCES epics(id) ON DELETE set null,
  imported_at text
);

CREATE UNIQUE INDEX IF NOT EXISTS github_issues_project_issue_unique
  ON github_issues(project_id, issue_number);

CREATE INDEX IF NOT EXISTS github_issues_project_synced_idx
  ON github_issues(project_id, synced_at);
