CREATE TABLE `ConflictCheck` (
	`id` text PRIMARY KEY NOT NULL,
	`intake_id` text,
	`query_name` text,
	`query_id_number` text,
	`candidate_role` text NOT NULL,
	`top_severity` text NOT NULL,
	`hit_count` integer NOT NULL,
	`checked_by_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `Counter` (
	`key` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `Matter` (
	`id` text PRIMARY KEY NOT NULL,
	`internal_code` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'PENDING_ACCEPTANCE' NOT NULL,
	`claim_amount` text,
	`primary_client_name` text,
	`our_standing` text,
	`owner_id` text NOT NULL,
	`intake_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Matter_internal_code_unique` ON `Matter` (`internal_code`);--> statement-breakpoint
CREATE INDEX `Matter_status_idx` ON `Matter` (`status`);--> statement-breakpoint
CREATE TABLE `Party` (
	`id` text PRIMARY KEY NOT NULL,
	`intake_id` text,
	`matter_id` text,
	`role` text NOT NULL,
	`name` text NOT NULL,
	`id_number` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `Party_name_idx` ON `Party` (`name`);--> statement-breakpoint
CREATE INDEX `Party_idnum_idx` ON `Party` (`id_number`);