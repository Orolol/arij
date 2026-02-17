-- Add release_id FK to epics table for tracking which release an epic belongs to
ALTER TABLE `epics` ADD `release_id` text REFERENCES releases(id) ON DELETE SET NULL;
