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

/** Atomic named counters (internalCode sequences, etc.). */
export const counters = sqliteTable("Counter", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});
