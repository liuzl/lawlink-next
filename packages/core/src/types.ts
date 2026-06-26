/**
 * Core domain types — framework-agnostic.
 *
 * Every use case in the core layer has the shape:
 *   (deps: Deps, auth: AuthContext, input: unknown) => Promise<Result>
 *
 * No Web framework, no implicit session, no global state. Everything a use
 * case needs is passed in explicitly so the same logic runs from the Hono API,
 * the CLI, an MCP shell, tests, or a cron job. See docs/REARCHITECTURE-PLAN.md §3.
 */
import type { Database } from "@lawlink/db";

/** Roles — domain vocabulary (DOMAIN-SPEC §2.1). Kept in the core layer. */
export type Role =
  | "ADMIN"
  | "PRINCIPAL_LAWYER"
  | "LAWYER"
  | "ASSISTANT"
  | "FINANCE";

/** Case category (DOMAIN-SPEC §4.1). */
export type MatterCategory =
  | "CIVIL_COMMERCIAL"
  | "CRIMINAL"
  | "ADMINISTRATIVE"
  | "NON_LITIGATION"
  | "LEGAL_COUNSEL"
  | "SPECIAL_PROJECT";

/** Intake status (DOMAIN-SPEC §5.1). */
export type IntakeStatus =
  | "INTAKE"
  | "PENDING_CONFIRMATION"
  | "CONVERTED"
  | "DECLINED";

/** The authenticated caller. Assembled by each entry shell (API/CLI), never
 * read implicitly from a request/session inside the core. */
export interface AuthContext {
  userId: string;
  role: Role;
}

/** Injected, side-effecting collaborators. Swapped freely in tests / adapters. */
export interface Deps {
  db: Database;
  ids: IdGen;
  clock: Clock;
}

export interface IdGen {
  newId(): string;
}

export interface Clock {
  now(): Date;
}

/** A domain-level error the entry shells map to an HTTP status / CLI exit code. */
export class DomainError extends Error {
  constructor(
    public code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "VALIDATION"
      | "CONFLICT"
      | "INVALID_STATE",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
