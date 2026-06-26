CREATE TABLE `ArchiveRecord` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`summary` text NOT NULL,
	`checklist_json` text DEFAULT '{}' NOT NULL,
	`missing_items` text DEFAULT '[]' NOT NULL,
	`force_reason` text,
	`archived_by_id` text NOT NULL,
	`archived_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ArchiveRecord_matter_idx` ON `ArchiveRecord` (`matter_id`);