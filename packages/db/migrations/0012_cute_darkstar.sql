CREATE TABLE `DocumentFolder` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`name` text NOT NULL,
	`order_index` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `DocumentFolder_matter_name_uq` ON `DocumentFolder` (`matter_id`,`name`);--> statement-breakpoint
CREATE INDEX `DocumentFolder_matter_idx` ON `DocumentFolder` (`matter_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `Document` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text,
	`intake_id` text,
	`procedure_id` text,
	`folder_id` text,
	`name` text NOT NULL,
	`category` text DEFAULT 'OTHER' NOT NULL,
	`source_party` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`reviewed_by_id` text,
	`reviewed_at` integer,
	`approved_by_id` text,
	`approved_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`is_latest` integer DEFAULT true NOT NULL,
	`family_id` text,
	`storage_key` text,
	`mime_type` text,
	`size` integer,
	`sha256` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `Document_matter_idx` ON `Document` (`matter_id`,`category`);--> statement-breakpoint
CREATE INDEX `Document_intake_idx` ON `Document` (`intake_id`);--> statement-breakpoint
CREATE INDEX `Document_folder_idx` ON `Document` (`folder_id`);--> statement-breakpoint
CREATE INDEX `Document_family_idx` ON `Document` (`family_id`);