-- Add ticket_counter to projects (shared sequence for epics + bugs)
ALTER TABLE projects ADD COLUMN ticket_counter INTEGER DEFAULT 0;
--> statement-breakpoint

-- Add readable_id to epics (E-project-001 or B-project-002)
ALTER TABLE epics ADD COLUMN readable_id TEXT;
--> statement-breakpoint

-- Add readable_agent_name to named_agents (Ancient Greek names)
ALTER TABLE named_agents ADD COLUMN readable_agent_name TEXT;
--> statement-breakpoint

-- Unique constraint on readable_agent_name (collision-safe)
CREATE UNIQUE INDEX IF NOT EXISTS named_agents_readable_agent_name_unique ON named_agents(readable_agent_name);
