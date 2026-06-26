CREATE TABLE `AuditLog` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`detail_json` text,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `AuditLog_user_idx` ON `AuditLog` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `AuditLog_action_idx` ON `AuditLog` (`action`,`created_at`);