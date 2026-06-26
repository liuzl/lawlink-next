CREATE TABLE `MatterMember` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'ASSISTANT' NOT NULL,
	`joined_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `MatterMember_matter_user_uq` ON `MatterMember` (`matter_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `MatterMember_user_idx` ON `MatterMember` (`user_id`);