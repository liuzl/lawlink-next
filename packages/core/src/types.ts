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

export const ROLES: readonly Role[] = [
  "ADMIN",
  "PRINCIPAL_LAWYER",
  "LAWYER",
  "ASSISTANT",
  "FINANCE",
];

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

/** Document material category (DOMAIN-SPEC §4.x). */
export type DocumentCategory =
  | "EVIDENCE"
  | "PLEADING"
  | "PROCEDURE"
  | "JUDGMENT"
  | "CONTRACT"
  | "OTHER";

/** Document review lifecycle (DOMAIN-SPEC §5.5). */
export type DocumentStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "FILED";

/** Seal kinds (用章种类, DOMAIN-SPEC §5.3). */
export type SealType =
  | "OFFICIAL_SEAL"
  | "CONTRACT_SEAL"
  | "CONTRACT_REVIEW_SEAL"
  | "FINANCE_SEAL"
  | "LEGAL_REP_SEAL";

/** Seal-request lifecycle (DOMAIN-SPEC §5.3). */
export type SealRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "STAMPED"
  | "REJECTED"
  | "CANCELLED";

export type Urgency = "NORMAL" | "URGENT";

/** Court-SMS classification (法院短信解析, DOMAIN-SPEC §5.6). */
export type SmsType =
  | "HEARING_NOTICE"
  | "SERVICE_NOTICE"
  | "FEE_NOTICE"
  | "MEDIATION"
  | "ENFORCEMENT"
  | "FILING_NOTICE"
  | "JUDGMENT_NOTICE"
  | "EVIDENCE_SUBMIT"
  | "OTHER";

/** How an SMS was matched to a matter. */
export type SmsMatchSource = "AUTO_CASE_NUMBER" | "MANUAL" | "UNMATCHED";

/** The authenticated caller. Assembled by each entry shell (API/CLI) from a
 * verified token, never read implicitly from a request/session in the core. */
export interface AuthContext {
  userId: string;
  role: Role;
}

/** Injected, side-effecting collaborators. Swapped freely in tests / adapters. */
export interface Deps {
  db: Database;
  ids: IdGen;
  clock: Clock;
  secrets: Secrets;
  audit: AuditSink;
}

/** Append-only audit trail (DOMAIN-SPEC §4.12). `record` is best-effort and
 * must never throw — auditing failures cannot break the main operation. */
export interface AuditEntry {
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: unknown;
}
export interface AuditSink {
  record(actor: { userId: string }, entry: AuditEntry): Promise<void>;
  /** Return a sink bound to a different db handle (e.g. a transaction) while
   * preserving request context (ip/userAgent). Optional: noop sinks omit it. */
  withDb?(db: Database): AuditSink;
}

export interface Secrets {
  /** HMAC secret for signing/verifying session JWTs. */
  jwt: string;
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
