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
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
  createdById: text("created_by_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
