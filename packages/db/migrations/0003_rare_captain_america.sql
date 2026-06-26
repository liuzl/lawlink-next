CREATE TABLE `Deadline` (
	`id` text PRIMARY KEY NOT NULL,
	`procedure_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`category` text DEFAULT 'CUSTOM' NOT NULL,
	`title` text NOT NULL,
	`due_at` integer NOT NULL,
	`basis` text,
	`source_event` text,
	`auto_computed` integer DEFAULT false NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `Deadline_matter_idx` ON `Deadline` (`matter_id`);--> statement-breakpoint
CREATE INDEX `Deadline_due_idx` ON `Deadline` (`due_at`,`completed`);