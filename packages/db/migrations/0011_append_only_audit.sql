-- Enforce AuditLog append-only at the storage boundary, not just by
-- convention: any UPDATE or DELETE aborts, even from a future code path,
-- migration, or admin shell sharing this DB handle. IF NOT EXISTS so the
-- migration is idempotent across fresh and already-upgraded databases.
CREATE TRIGGER IF NOT EXISTS `AuditLog_no_update` BEFORE UPDATE ON `AuditLog`
BEGIN
	SELECT RAISE(ABORT, 'AuditLog is append-only');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `AuditLog_no_delete` BEFORE DELETE ON `AuditLog`
BEGIN
	SELECT RAISE(ABORT, 'AuditLog is append-only');
END;
