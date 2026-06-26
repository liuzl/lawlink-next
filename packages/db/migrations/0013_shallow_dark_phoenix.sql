CREATE TABLE `SealRequest` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`seal_type` text NOT NULL,
	`matter_id` text,
	`purpose` text NOT NULL,
	`document_title` text NOT NULL,
	`page_count` integer DEFAULT 1 NOT NULL,
	`require_cross_page_seal` integer DEFAULT false NOT NULL,
	`copies` integer DEFAULT 1 NOT NULL,
	`urgency` text DEFAULT 'NORMAL' NOT NULL,
	`draft_doc_id` text NOT NULL,
	`stamped_doc_id` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`request_note` text,
	`approve_note` text,
	`requested_by_id` text NOT NULL,
	`requested_at` integer NOT NULL,
	`approved_by_id` text,
	`approved_at` integer,
	`stamped_by_id` text,
	`stamped_at` integer,
	`rejected_at` integer,
	`parent_seal_request_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `SealRequest_code_unique` ON `SealRequest` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `SealRequest_draft_doc_id_unique` ON `SealRequest` (`draft_doc_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `SealRequest_stamped_doc_id_unique` ON `SealRequest` (`stamped_doc_id`);--> statement-breakpoint
CREATE INDEX `SealRequest_status_idx` ON `SealRequest` (`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `SealRequest_requester_idx` ON `SealRequest` (`requested_by_id`,`status`);--> statement-breakpoint
CREATE INDEX `SealRequest_type_idx` ON `SealRequest` (`seal_type`,`status`);--> statement-breakpoint
CREATE INDEX `SealRequest_matter_idx` ON `SealRequest` (`matter_id`);--> statement-breakpoint
CREATE TABLE `SystemSetting` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
