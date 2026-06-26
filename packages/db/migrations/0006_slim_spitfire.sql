CREATE TABLE `Hearing` (
	`id` text PRIMARY KEY NOT NULL,
	`procedure_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`title` text NOT NULL,
	`room` text,
	`address` text,
	`judge` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `Hearing_matter_idx` ON `Hearing` (`matter_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `Note` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`author_id` text NOT NULL,
	`channel` text DEFAULT 'OTHER' NOT NULL,
	`with_whom` text,
	`occurred_at` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `Note_matter_idx` ON `Note` (`matter_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `Task` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`assignee_id` text,
	`due_at` integer,
	`completed` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`created_by_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `Task_matter_idx` ON `Task` (`matter_id`,`completed`);