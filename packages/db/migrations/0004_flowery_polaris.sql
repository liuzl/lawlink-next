CREATE TABLE `PreservationRenewal` (
	`id` text PRIMARY KEY NOT NULL,
	`preservation_id` text NOT NULL,
	`old_expiry_date` integer NOT NULL,
	`new_expiry_date` integer NOT NULL,
	`renewed_at` integer NOT NULL,
	`performed_by_id` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `PreservationRenewal_pres_idx` ON `PreservationRenewal` (`preservation_id`);--> statement-breakpoint
CREATE TABLE `Preservation` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`type` text NOT NULL,
	`property_type` text NOT NULL,
	`amount` text,
	`respondent` text,
	`guarantee_type` text,
	`start_date` integer NOT NULL,
	`duration_days` integer NOT NULL,
	`expiry_date` integer NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`remind_days` text DEFAULT '[30,15,7,3,1]' NOT NULL,
	`owner_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `Preservation_matter_idx` ON `Preservation` (`matter_id`);--> statement-breakpoint
CREATE INDEX `Preservation_expiry_idx` ON `Preservation` (`status`,`expiry_date`);