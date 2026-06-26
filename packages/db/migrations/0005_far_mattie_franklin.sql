CREATE TABLE `Client` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'INDIVIDUAL' NOT NULL,
	`id_number` text,
	`phone` text,
	`email` text,
	`address` text,
	`source` text,
	`notes` text,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `Client_name_idx` ON `Client` (`name`);--> statement-breakpoint
CREATE INDEX `Client_idnum_idx` ON `Client` (`id_number`);--> statement-breakpoint
CREATE TABLE `Contact` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`title` text,
	`phone` text,
	`email` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `Contact_client_idx` ON `Contact` (`client_id`);