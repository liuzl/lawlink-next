DROP INDEX `ArchiveRecord_matter_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `ArchiveRecord_matter_uq` ON `ArchiveRecord` (`matter_id`);