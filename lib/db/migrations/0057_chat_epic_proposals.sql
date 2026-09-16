-- The proposal claim commits with its epic and stories. NULL epic_id is a
-- tombstone so replaying a delayed request cannot recreate a deleted ticket.
CREATE TABLE IF NOT EXISTS `chat_epic_proposals` (
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `conversation_id` text NOT NULL REFERENCES `chat_conversations`(`id`) ON DELETE CASCADE,
  `proposal_hash` text NOT NULL,
  `epic_id` text REFERENCES `epics`(`id`) ON DELETE SET NULL,
  `user_stories_created` integer NOT NULL,
  `dependencies_created` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`project_id`, `conversation_id`, `proposal_hash`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chat_epic_proposals_conversation_idx` ON `chat_epic_proposals` (`conversation_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chat_epic_proposals_epic_idx` ON `chat_epic_proposals` (`epic_id`);
