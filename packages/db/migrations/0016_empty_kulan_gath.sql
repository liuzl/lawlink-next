CREATE TABLE `Notification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`priority` text DEFAULT 'NORMAL' NOT NULL,
	`title` text NOT NULL,
	`content` text,
	`href` text,
	`ref_type` text,
	`ref_id` text,
	`read` integer DEFAULT false NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `Notification_user_unread_idx` ON `Notification` (`user_id`,`read`,`created_at`);--> statement-breakpoint
CREATE INDEX `Notification_user_idx` ON `Notification` (`user_id`,`created_at`);