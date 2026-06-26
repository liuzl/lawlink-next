CREATE TABLE `MatterProcedure` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`type` text NOT NULL,
	`engagement` text DEFAULT 'ENGAGED' NOT NULL,
	`order` integer NOT NULL,
	`case_number` text,
	`handling_agency` text,
	`handler` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`outcome` text,
	`accepted_at` integer,
	`concluded_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `MatterProcedure_matter_order_uq` ON `MatterProcedure` (`matter_id`,`order`);