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

/** In-app notification kinds (通知中心). */
export type NotificationType =
  | "PRESERVATION_EXPIRY"
  | "HEARING_REMINDER"
  | "DEADLINE_REMINDER"
  | "SEAL_STATUS_CHANGE"
  | "SMS_ARRIVAL"
  | "TASK_ASSIGNED"
  | "ARCHIVE_APPROVED"
  | "ARCHIVE_REJECTED"
  | "SYSTEM";

export type NotificationPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

/** Invoice-request lifecycle (开票, DOMAIN-SPEC §5.4). */
/** Matter team membership role (主办 / 协办 / 助理). Distinct from the firm-level
 * user Role — a LAWYER user can be LEAD on one matter and ASSISTANT on another. */
export type MatterMemberRole = "LEAD" | "CO_LEAD" | "ASSISTANT";

export type InvoiceRequestStatus = "PENDING" | "APPROVED" | "ISSUED" | "REJECTED";
/** 普通发票 / 增值税专用发票. */
export type InvoiceType = "PLAIN" | "SPECIAL";
export type InvoiceItem = "LAWYER_FEE" | "CONSULTING_FEE" | "AGENCY_FEE" | "OTHER";

/** Document-template category (文书模板, DOMAIN-SPEC §5.5). */
export type TemplateCategory =
  | "INTAKE"
  | "RETAINER"
  | "LITIGATION"
  | "HEARING"
  | "WORK_PRODUCT"
  | "ARCHIVE"
  | "CLOSING"
  | "BLANK";

/** The authenticated caller. Assembled by each entry shell (API/CLI) from a
 * verified token, never read implicitly from a request/session in the core. */
export interface AuthContext {
  userId: string;
  role: Role;
}

/** Blob/file storage for document bytes. The metadata (Document rows) lives in
 * the db; the bytes live here, keyed by an opaque storageKey. Self-host uses a
 * local-FS adapter; Cloudflare uses R2 (both implement this interface). */
export interface StorageAdapter {
  put(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array>; // throws NOT_FOUND-style error if absent
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/** Injected, side-effecting collaborators. Swapped freely in tests / adapters. */
export interface Deps {
  db: Database;
  ids: IdGen;
  clock: Clock;
  secrets: Secrets;
  audit: AuditSink;
  storage: StorageAdapter;
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
      | "UNAUTHENTICATED"
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
