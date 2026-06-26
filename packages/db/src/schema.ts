/**
 * Drizzle schema — SQLite/D1 compatible.
 *
 * The DB layer is dumb storage with NO domain knowledge:
 *  - enums are plain `text` columns (the typed unions live in @lawlink/core);
 *  - money is `text` (SQLite has no decimal; arithmetic happens in core);
 *  - timestamps are integer epoch (`mode: "timestamp"`).
 *
 * This is a P0 slice (User + Intake) proving the pattern. The full schema is
 * ported per docs/SQLITE_D1_MIGRATION.md in P2.
 */
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("User", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("LAWYER"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const intakes = sqliteTable("Intake", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull().default("CIVIL_COMMERCIAL"),
  status: text("status").notNull().default("INTAKE"),
  claimAmount: text("claim_amount"),
  clientName: text("client_name").notNull(),
  declinedReason: text("declined_reason"),
  createdById: text("created_by_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const matters = sqliteTable(
  "Matter",
  {
    id: text("id").primaryKey(),
    internalCode: text("internal_code").notNull().unique(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull().default("PENDING_ACCEPTANCE"),
    claimAmount: text("claim_amount"),
    primaryClientName: text("primary_client_name"),
    ourStanding: text("our_standing"),
    ownerId: text("owner_id").notNull(),
    intakeId: text("intake_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("Matter_status_idx").on(t.status)],
);

/** Parties of an intake or matter — the conflict-check search corpus. */
export const parties = sqliteTable(
  "Party",
  {
    id: text("id").primaryKey(),
    intakeId: text("intake_id"),
    matterId: text("matter_id"),
    // CLIENT_PARTY | OPPOSING_PARTY | THIRD_PARTY
    role: text("role").notNull(),
    name: text("name").notNull(),
    idNumber: text("id_number"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("Party_name_idx").on(t.name), index("Party_idnum_idx").on(t.idNumber)],
);

/** Audit record of a conflict check (one row per run; hits returned in-memory). */
export const conflictChecks = sqliteTable("ConflictCheck", {
  id: text("id").primaryKey(),
  intakeId: text("intake_id"),
  queryName: text("query_name"),
  queryIdNumber: text("query_id_number"),
  candidateRole: text("candidate_role").notNull(),
  topSeverity: text("top_severity").notNull(),
  hitCount: integer("hit_count").notNull(),
  checkedById: text("checked_by_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/** A procedure within a matter (一审/二审/执行…). DOMAIN-SPEC §3. */
export const matterProcedures = sqliteTable(
  "MatterProcedure",
  {
    id: text("id").primaryKey(),
    matterId: text("matter_id").notNull(),
    type: text("type").notNull(),
    // ENGAGED (我方代理) | INFORMATIONAL (前序参考)
    engagement: text("engagement").notNull().default("ENGAGED"),
    order: integer("order").notNull(),
    caseNumber: text("case_number"),
    handlingAgency: text("handling_agency"),
    handler: text("handler"),
    // PENDING | IN_PROGRESS | CONCLUDED
    status: text("status").notNull().default("PENDING"),
    outcome: text("outcome"),
    acceptedAt: integer("accepted_at", { mode: "timestamp" }),
    concludedAt: integer("concluded_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("MatterProcedure_matter_order_uq").on(t.matterId, t.order)],
);

/** A deadline on a procedure (DOMAIN-SPEC §6.4, §9.1). May be auto-computed. */
export const deadlines = sqliteTable(
  "Deadline",
  {
    id: text("id").primaryKey(),
    procedureId: text("procedure_id").notNull(),
    matterId: text("matter_id").notNull(),
    // LIMITATION|EVIDENCE|APPEAL|PERFORMANCE|RESPONSE|ENFORCEMENT|ARBITRATION_SET_ASIDE|RETRIAL_APPLICATION|CUSTOM
    category: text("category").notNull().default("CUSTOM"),
    title: text("title").notNull(),
    dueAt: integer("due_at", { mode: "timestamp" }).notNull(),
    basis: text("basis"),
    // event the deadline was derived from (auto-computed only), null for manual
    sourceEvent: text("source_event"),
    autoComputed: integer("auto_computed", { mode: "boolean" }).notNull().default(false),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("Deadline_matter_idx").on(t.matterId),
    index("Deadline_due_idx").on(t.dueAt, t.completed),
  ],
);

/** Property preservation (财产保全) — expiry tracking + renewal (DOMAIN-SPEC §6.5, §9.2). */
export const preservations = sqliteTable(
  "Preservation",
  {
    id: text("id").primaryKey(),
    matterId: text("matter_id").notNull(),
    // PRE_LITIGATION | IN_LITIGATION | ENFORCEMENT
    type: text("type").notNull(),
    // BANK_DEPOSIT | REAL_ESTATE | VEHICLE | EQUITY | IP | OTHER
    propertyType: text("property_type").notNull(),
    amount: text("amount"),
    respondent: text("respondent"),
    guaranteeType: text("guarantee_type"),
    startDate: integer("start_date", { mode: "timestamp" }).notNull(),
    durationDays: integer("duration_days").notNull(),
    expiryDate: integer("expiry_date", { mode: "timestamp" }).notNull(),
    // ACTIVE | RENEWED | EXPIRED | LIFTED
    status: text("status").notNull().default("ACTIVE"),
    remindDays: text("remind_days").notNull().default("[30,15,7,3,1]"),
    ownerId: text("owner_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("Preservation_matter_idx").on(t.matterId),
    index("Preservation_expiry_idx").on(t.status, t.expiryDate),
  ],
);

export const preservationRenewals = sqliteTable(
  "PreservationRenewal",
  {
    id: text("id").primaryKey(),
    preservationId: text("preservation_id").notNull(),
    oldExpiryDate: integer("old_expiry_date", { mode: "timestamp" }).notNull(),
    newExpiryDate: integer("new_expiry_date", { mode: "timestamp" }).notNull(),
    renewedAt: integer("renewed_at", { mode: "timestamp" }).notNull(),
    performedById: text("performed_by_id").notNull(),
    note: text("note"),
  },
  (t) => [index("PreservationRenewal_pres_idx").on(t.preservationId)],
);

/** Atomic named counters (internalCode sequences, etc.). */
export const counters = sqliteTable("Counter", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});
