/**
 * Documents (材料/文书) — metadata register + review lifecycle (DOMAIN-SPEC §5.5).
 *
 * Lifecycle: DRAFT → PENDING_REVIEW → APPROVED → FILED, with reject back to
 * DRAFT. Transitions are predicate-guarded (update ... WHERE status = expected)
 * so two concurrent reviewers can't both advance the same document.
 *
 * Binary bytes are out of scope here: `storageKey` is an opaque pointer the
 * upload adapter fills (R2/D1 infra, a later increment). This layer owns the
 * metadata, folder placement, lifecycle and soft-delete.
 */
import { z } from "zod";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { documentFolders, documents, matters } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { requireRole } from "../permissions.js";
import { assertMatterAccess } from "../matter/access.js";
import { assertMatterWritable } from "../matter/guards.js";

const CATEGORY = z.enum(["EVIDENCE", "PLEADING", "PROCEDURE", "JUDGMENT", "CONTRACT", "OTHER"]);

/**
 * Correlated guard: the document's matter is NOT archived. Added to every
 * document write predicate so an archive landing AFTER the preflight check
 * (TOCTOU) still can't mutate a closed case's materials — the guarded write
 * simply matches 0 rows. The preflight in writableDocument() handles the common
 * case with a precise message; this closes the race.
 */
const matterNotArchived = sql`exists (select 1 from ${matters} where ${matters.id} = ${documents.matterId} and ${matters.status} <> 'ARCHIVED')`;

/** Load a document (excluding soft-deleted) + assert matter WRITE access. */
async function writableDocument(deps: Deps, auth: AuthContext, documentId: string) {
  const [doc] = await deps.db
    .select({ id: documents.id, matterId: documents.matterId, status: documents.status })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);
  if (!doc) throw new DomainError("NOT_FOUND", "材料不存在");
  if (!doc.matterId) throw new DomainError("INVALID_STATE", "材料尚未归属案件");
  await assertMatterWritable(deps.db, auth, doc.matterId);
  return doc;
}

export const RegisterDocumentInput = z.object({
  matterId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  category: CATEGORY.default("OTHER"),
  folderId: z.string().min(1).optional(),
  sourceParty: z.string().max(120).optional(),
  // Blob metadata supplied by the upload adapter (all optional at register).
  storageKey: z.string().max(512).optional(),
  mimeType: z.string().max(120).optional(),
  size: z.coerce.number().int().nonnegative().optional(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i, "sha256 应为 64 位十六进制").optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

/** Register a document's metadata against a matter (status starts DRAFT). */
export async function registerDocument(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT");
  const input = RegisterDocumentInput.parse(rawInput);
  await assertMatterWritable(deps.db, auth, input.matterId); // preflight (precise errors)

  const now = deps.clock.now();
  const id = deps.ids.newId();
  // Re-validate matter (not archived) AND folder placement INSIDE the txn, right
  // before the insert, so an archive/folder-delete landing after the preflight
  // can't slip a material onto a closed case or a vanished folder.
  await deps.db.transaction(async (tx) => {
    const [m] = await tx
      .select({ status: matters.status })
      .from(matters)
      .where(eq(matters.id, input.matterId))
      .limit(1);
    if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
    if (m.status === "ARCHIVED") throw new DomainError("INVALID_STATE", "案件已归档，处于只读状态，不能登记材料");
    if (input.folderId) {
      const [f] = await tx
        .select({ matterId: documentFolders.matterId })
        .from(documentFolders)
        .where(eq(documentFolders.id, input.folderId))
        .limit(1);
      if (!f || f.matterId !== input.matterId) throw new DomainError("VALIDATION", "卷宗不属于本案件");
    }
    await tx.insert(documents).values({
      id,
      matterId: input.matterId,
      intakeId: null,
      procedureId: null,
      folderId: input.folderId ?? null,
      name: input.name,
      category: input.category,
      sourceParty: input.sourceParty ?? null,
      status: "DRAFT",
      reviewedById: null,
      reviewedAt: null,
      approvedById: null,
      approvedAt: null,
      version: 1,
      isLatest: true,
      familyId: null,
      storageKey: input.storageKey ?? null,
      mimeType: input.mimeType ?? null,
      size: input.size ?? null,
      sha256: input.sha256 ?? null,
      tagsJson: JSON.stringify(input.tags ?? []),
      uploadedById: auth.userId,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  });
  await deps.audit.record(auth, {
    action: "DOCUMENT_REGISTER",
    targetType: "Document",
    targetId: id,
    detail: { matterId: input.matterId, category: input.category, folderId: input.folderId ?? null },
  });
  return { id, name: input.name, status: "DRAFT" as const };
}

export async function listDocuments(deps: Deps, auth: AuthContext, rawInput: { matterId: string }) {
  const [m] = await deps.db
    .select({ ownerId: matters.ownerId })
    .from(matters)
    .where(eq(matters.id, rawInput.matterId))
    .limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  assertMatterAccess(m, auth); // archived matters remain viewable
  const rows = await deps.db
    .select()
    .from(documents)
    .where(and(eq(documents.matterId, rawInput.matterId), isNull(documents.deletedAt)))
    .orderBy(asc(documents.folderId), desc(documents.createdAt));
  return rows.map((r) => ({ ...r, tags: JSON.parse(r.tagsJson) as string[] }));
}

export const MoveDocumentInput = z.object({
  documentId: z.string().min(1),
  // null/omitted → move to the matter root (unfiled).
  folderId: z.string().min(1).nullish(),
});

export async function moveDocument(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT");
  const input = MoveDocumentInput.parse(rawInput);
  const doc = await writableDocument(deps, auth, input.documentId);

  if (input.folderId) {
    const [f] = await deps.db
      .select({ matterId: documentFolders.matterId })
      .from(documentFolders)
      .where(eq(documentFolders.id, input.folderId))
      .limit(1);
    if (!f || f.matterId !== doc.matterId) throw new DomainError("VALIDATION", "卷宗不属于本案件");
  }

  const moved = await deps.db
    .update(documents)
    .set({ folderId: input.folderId ?? null, updatedAt: deps.clock.now() })
    .where(and(eq(documents.id, input.documentId), isNull(documents.deletedAt), matterNotArchived))
    .returning({ id: documents.id });
  if (moved.length === 0) throw new DomainError("INVALID_STATE", "材料已删除或案件已归档，不能移动");
  await deps.audit.record(auth, {
    action: "DOCUMENT_MOVE",
    targetType: "Document",
    targetId: input.documentId,
    detail: { matterId: doc.matterId, folderId: input.folderId ?? null },
  });
  return { id: input.documentId, folderId: input.folderId ?? null };
}

/** Predicate-guarded status transition. Returns the row or throws INVALID_STATE
 * if the document is not in `from` (already advanced / concurrent change). */
async function transition(
  deps: Deps,
  documentId: string,
  from: string,
  set: Record<string, unknown>,
  msg: string,
) {
  const updated = await deps.db
    .update(documents)
    .set({ ...set, updatedAt: deps.clock.now() })
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.status, from),
        isNull(documents.deletedAt),
        matterNotArchived,
      ),
    )
    .returning({ id: documents.id });
  if (updated.length === 0) throw new DomainError("INVALID_STATE", msg);
}

export const DocumentIdInput = z.object({ documentId: z.string().min(1) });

/** DRAFT → PENDING_REVIEW. */
export async function submitDocumentForReview(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT");
  const { documentId } = DocumentIdInput.parse(rawInput);
  const doc = await writableDocument(deps, auth, documentId);
  await transition(deps, documentId, "DRAFT", { status: "PENDING_REVIEW" }, "仅草稿可提交审核");
  await deps.audit.record(auth, {
    action: "DOCUMENT_SUBMIT_REVIEW",
    targetType: "Document",
    targetId: documentId,
    detail: { matterId: doc.matterId },
  });
  return { id: documentId, status: "PENDING_REVIEW" as const };
}

/** PENDING_REVIEW → APPROVED. Reviewer = management (审批权, DOMAIN-SPEC §5.5). */
export async function approveDocument(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER");
  const { documentId } = DocumentIdInput.parse(rawInput);
  const doc = await writableDocument(deps, auth, documentId);
  const now = deps.clock.now();
  await transition(
    deps,
    documentId,
    "PENDING_REVIEW",
    { status: "APPROVED", reviewedById: auth.userId, reviewedAt: now, approvedById: auth.userId, approvedAt: now },
    "仅待审材料可通过审核",
  );
  await deps.audit.record(auth, {
    action: "DOCUMENT_APPROVE",
    targetType: "Document",
    targetId: documentId,
    detail: { matterId: doc.matterId },
  });
  return { id: documentId, status: "APPROVED" as const };
}

export const RejectDocumentInput = z.object({
  documentId: z.string().min(1),
  reason: z.string().max(300).optional(),
});

/** PENDING_REVIEW → DRAFT (reviewer sends back). Reason is not persisted on the
 * record (no field); only its presence is audited (PII-safe). */
export async function rejectDocument(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER");
  const input = RejectDocumentInput.parse(rawInput);
  const doc = await writableDocument(deps, auth, input.documentId);
  await transition(deps, input.documentId, "PENDING_REVIEW", { status: "DRAFT" }, "仅待审材料可退回");
  await deps.audit.record(auth, {
    action: "DOCUMENT_REJECT",
    targetType: "Document",
    targetId: input.documentId,
    detail: { matterId: doc.matterId, hasReason: (input.reason?.length ?? 0) > 0 },
  });
  return { id: input.documentId, status: "DRAFT" as const };
}

/** APPROVED → FILED (入卷归档). */
export async function fileDocument(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT");
  const { documentId } = DocumentIdInput.parse(rawInput);
  const doc = await writableDocument(deps, auth, documentId);
  await transition(deps, documentId, "APPROVED", { status: "FILED" }, "仅已通过审核的材料可入卷");
  await deps.audit.record(auth, {
    action: "DOCUMENT_FILE",
    targetType: "Document",
    targetId: documentId,
    detail: { matterId: doc.matterId },
  });
  return { id: documentId, status: "FILED" as const };
}

/** Soft-delete (deletedAt). Bytes/blob cleanup is the upload adapter's concern. */
export async function deleteDocument(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER");
  const { documentId } = DocumentIdInput.parse(rawInput);
  const doc = await writableDocument(deps, auth, documentId);
  // Guard the soft-delete on matter-not-archived too (race backstop). Clearing
  // folderId on delete keeps the orphan-by-deleted-folder surface minimal.
  const removed = await deps.db
    .update(documents)
    .set({ deletedAt: deps.clock.now(), isLatest: false, folderId: null })
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt), matterNotArchived))
    .returning({ id: documents.id });
  if (removed.length === 0) throw new DomainError("INVALID_STATE", "材料已删除或案件已归档");
  await deps.audit.record(auth, {
    action: "DOCUMENT_DELETE",
    targetType: "Document",
    targetId: documentId,
    detail: { matterId: doc.matterId },
  });
  return { id: documentId, deleted: true };
}
