DROP INDEX `ArchiveRecord_matter_idx`;--> statement-breakpoint
-- Repair any duplicate ArchiveRecord rows for a matter (possible before the
-- unique constraint / atomic archive claim existed), keeping the earliest row,
-- so CREATE UNIQUE INDEX below cannot abort the migration on existing data.
DELETE FROM `ArchiveRecord` WHERE `rowid` NOT IN (
  SELECT MIN(`rowid`) FROM `ArchiveRecord` GROUP BY `matter_id`
);--> statement-breakpoint
CREATE UNIQUE INDEX `ArchiveRecord_matter_uq` ON `ArchiveRecord` (`matter_id`);