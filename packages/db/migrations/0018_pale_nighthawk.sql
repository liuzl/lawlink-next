CREATE TABLE `InvoiceRequest` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text,
	`no_matter_reason` text,
	`amount` text NOT NULL,
	`title` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`request_note` text,
	`invoice_type` text,
	`invoice_item` text,
	`buyer_name` text,
	`buyer_tax_no` text,
	`buyer_address` text,
	`buyer_phone` text,
	`buyer_bank` text,
	`buyer_bank_account` text,
	`evidence_doc_ids_json` text DEFAULT '[]' NOT NULL,
	`invoice_no` text,
	`issued_at` integer,
	`requested_by_id` text NOT NULL,
	`requested_at` integer NOT NULL,
	`processed_by_id` text,
	`processed_at` integer,
	`process_note` text,
	`contract_scan_id` text,
	`invoice_file_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `InvoiceRequest_contract_scan_id_unique` ON `InvoiceRequest` (`contract_scan_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `InvoiceRequest_invoice_file_id_unique` ON `InvoiceRequest` (`invoice_file_id`);--> statement-breakpoint
CREATE INDEX `InvoiceRequest_matter_idx` ON `InvoiceRequest` (`matter_id`,`status`);--> statement-breakpoint
CREATE INDEX `InvoiceRequest_status_idx` ON `InvoiceRequest` (`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `InvoiceRequest_requester_idx` ON `InvoiceRequest` (`requested_by_id`);