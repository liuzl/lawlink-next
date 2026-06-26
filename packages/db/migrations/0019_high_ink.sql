CREATE TABLE `DocumentTemplate` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`description` text,
	`applicable_categories_json` text DEFAULT '[]' NOT NULL,
	`docx_storage_key` text NOT NULL,
	`variables_json` text DEFAULT '[]' NOT NULL,
	`is_built_in` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `DocumentTemplate_category_idx` ON `DocumentTemplate` (`category`,`enabled`);--> statement-breakpoint
ALTER TABLE `Document` ADD `template_id` text;--> statement-breakpoint
ALTER TABLE `Document` ADD `template_context_json` text;