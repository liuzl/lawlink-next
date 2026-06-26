CREATE TABLE `Billing` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`title` text NOT NULL,
	`contract_amount` text NOT NULL,
	`schedule` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`signed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `Billing_matter_idx` ON `Billing` (`matter_id`);--> statement-breakpoint
CREATE TABLE `CommissionPlan` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`user_id` text NOT NULL,
	`percent` text NOT NULL,
	`label` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `CommissionPlan_matter_user_uq` ON `CommissionPlan` (`matter_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `FeeEntry` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`billing_id` text,
	`type` text NOT NULL,
	`amount` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`invoice_no` text,
	`payer_or_payee` text,
	`method` text,
	`note` text,
	`parent_fee_entry_id` text,
	`beneficiary_user_id` text,
	`recorded_by_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `FeeEntry_matter_idx` ON `FeeEntry` (`matter_id`,`type`);--> statement-breakpoint
CREATE INDEX `FeeEntry_parent_idx` ON `FeeEntry` (`parent_fee_entry_id`);