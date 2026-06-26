CREATE TABLE `SmsMessage` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_text` text NOT NULL,
	`received_at` integer NOT NULL,
	`received_by_id` text NOT NULL,
	`parsed_json` text NOT NULL,
	`sms_type` text DEFAULT 'OTHER' NOT NULL,
	`matched_matter_id` text,
	`matched_by` text DEFAULT 'UNMATCHED' NOT NULL,
	`generated_hearing_id` text,
	`generated_deadline_id` text,
	`processed` integer DEFAULT false NOT NULL,
	`processed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `SmsMessage_receiver_idx` ON `SmsMessage` (`received_by_id`,`processed`,`received_at`);--> statement-breakpoint
CREATE INDEX `SmsMessage_matter_idx` ON `SmsMessage` (`matched_matter_id`);--> statement-breakpoint
CREATE INDEX `SmsMessage_type_idx` ON `SmsMessage` (`sms_type`,`received_at`);