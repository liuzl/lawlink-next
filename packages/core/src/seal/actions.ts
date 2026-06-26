/**
 * Seal-use approval workflow (用印审批, DOMAIN-SPEC §5.3).
 *
 * PENDING → APPROVED → STAMPED, with side branches REJECTED / CANCELLED.
 * - The draft (待盖章稿) is a Document id, required at creation.
 * - The stamped scan (盖章后扫描件) is a Document id, REQUIRED to reach STAMPED
 *   (compliance: the post-stamp record can't be backfilled, so it's gated here).
 * - The approver is mapped by seal type (SEAL_TYPES); LEGAL_REP_SEAL needs the
 *   firm legal-rep from settings; ADMIN may approve any seal.
 *
 * Transitions are predicate-guarded (UPDATE ... WHERE status = expected) so two
 * approvers can't both advance the same request.
 */
import { z } from "zod";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { counters, documents, matters, sealRequests } from "@lawlink/db";
import {
  DomainError,
  type AuthContext,
  type Deps,
  type SealType,
} from "../types.js";
import { requireRole } from "../permissions.js";
import { assertMatterAccess } from "../matter/access.js";
import { getFirmLegalRepUserId } from "../settings/actions.js";
import { SEAL_TYPES, approvableSealTypes, isSealType } from "./types.js";

const SEAL_TYPE = z.enum([
  "OFFICIAL_SEAL",
  "CONTRACT_SEAL",
  "CONTRACT_REVIEW_SEAL",
  "FINANCE_SEAL",
  "LEGAL_REP_SEAL",
]);

/** Resolve & assert the caller may approve/stamp a seal of this type. */
async function assertCanApprove(deps: Deps, auth: AuthContext, sealType: SealType) {
  if (auth.role === "ADMIN") return; // 跨章可审
  const def = SEAL_TYPES[sealType];
  if (def.requiresLegalRep) {
    const legalRep = await getFirmLegalRepUserId(deps);
    if (!legalRep) throw new DomainError("INVALID_STATE", "未配置法定代表人，无法审批法定代表人章");
    if (auth.userId !== legalRep) throw new DomainError("FORBIDDEN", "仅法定代表人本人可审批此章");
    return;
  }
  if (!def.approverRoles.includes(auth.role)) {
    throw new DomainError("FORBIDDEN", `无权审批${def.label}`);
  }
}

/** Load a non-deleted Document or throw. Optionally bind it to a matter. */
async function loadDocument(deps: Deps, docId: string) {
  const [doc] = await deps.db
    .select({ id: documents.id, matterId: documents.matterId, deletedAt: documents.deletedAt })
    .from(documents)
    .where(eq(documents.id, docId))
    .limit(1);
  if (!doc || doc.deletedAt) throw new DomainError("NOT_FOUND", "文件不存在");
  return doc;
}

// ── create ────────────────────────────────────────────────────────────────────
export const CreateSealRequestInput = z.object({
  sealType: SEAL_TYPE,
  matterId: z.string().min(1).optional(),
  purpose: z.string().trim().min(1).max(500),
  documentTitle: z.string().trim().min(1).max(200),
  pageCount: z.coerce.number().int().positive().max(100000).default(1),
  requireCrossPageSeal: z.coerce.boolean().default(false),
  copies: z.coerce.number().int().positive().max(1000).default(1),
  urgency: z.enum(["NORMAL", "URGENT"]).default("NORMAL"),
  draftDocId: z.string().min(1),
  requestNote: z.string().max(500).optional(),
  parentSealRequestId: z.string().min(1).optional(),
});

export async function createSealRequest(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT");
  const input = CreateSealRequestInput.parse(rawInput);

  const draft = await loadDocument(deps, input.draftDocId);
  // The draft's matter (if any) and the requested matter must agree; the
  // requester must be able to access whichever matter is in play.
  const matterId = input.matterId ?? draft.matterId ?? null;
  if (input.matterId && draft.matterId && input.matterId !== draft.matterId) {
    throw new DomainError("VALIDATION", "待盖章稿不属于该案件");
  }
  if (matterId) {
    const [m] = await deps.db.select({ ownerId: matters.ownerId }).from(matters).where(eq(matters.id, matterId)).limit(1);
    if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
    assertMatterAccess(m, auth);
  }

  // Resubmission: the parent must be a REJECTED request the same user owns.
  if (input.parentSealRequestId) {
    const [parent] = await deps.db
      .select({ status: sealRequests.status, requestedById: sealRequests.requestedById })
      .from(sealRequests)
      .where(eq(sealRequests.id, input.parentSealRequestId))
      .limit(1);
    if (!parent) throw new DomainError("NOT_FOUND", "原用印申请不存在");
    if (parent.status !== "REJECTED") throw new DomainError("INVALID_STATE", "仅被驳回的申请可重新提交");
    if (parent.requestedById !== auth.userId) throw new DomainError("FORBIDDEN", "只能重新提交本人被驳回的申请");
  }

  const now = deps.clock.now();
  const year = now.getFullYear();
  const id = deps.ids.newId();
  let code = "";
  try {
    code = await deps.db.transaction(async (tx) => {
      // Atomic per-year sequence: SEAL-{year}-{NNNN}.
      const [counter] = await tx
        .insert(counters)
        .values({ key: `seal-${year}`, value: 1 })
        .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } })
        .returning({ value: counters.value });
      const c = `SEAL-${year}-${String(counter.value).padStart(4, "0")}`;
      await tx.insert(sealRequests).values({
        id,
        code: c,
        sealType: input.sealType,
        matterId,
        purpose: input.purpose,
        documentTitle: input.documentTitle,
        pageCount: input.pageCount,
        requireCrossPageSeal: input.requireCrossPageSeal,
        copies: input.copies,
        urgency: input.urgency,
        draftDocId: input.draftDocId,
        stampedDocId: null,
        status: "PENDING",
        requestNote: input.requestNote ?? null,
        approveNote: null,
        requestedById: auth.userId,
        requestedAt: now,
        approvedById: null,
        approvedAt: null,
        stampedById: null,
        stampedAt: null,
        rejectedAt: null,
        parentSealRequestId: input.parentSealRequestId ?? null,
        createdAt: now,
        updatedAt: now,
      });
      return c;
    });
  } catch {
    // The only realistic conflict is the unique draftDocId (one draft = one seal).
    throw new DomainError("CONFLICT", "该待盖章稿已被其他用印申请占用");
  }
  await deps.audit.record(auth, {
    action: "SEAL_REQUEST_CREATE",
    targetType: "SealRequest",
    targetId: id,
    detail: { code, sealType: input.sealType, matterId, urgency: input.urgency },
  });
  return { id, code, status: "PENDING" as const };
}

// ── status transitions ──────────────────────────────────────────────────────
/** Predicate-guarded transition keyed on the current status. */
async function transition(
  deps: Deps,
  sealRequestId: string,
  from: string,
  set: Record<string, unknown>,
  msg: string,
) {
  const updated = await deps.db
    .update(sealRequests)
    .set({ ...set, updatedAt: deps.clock.now() })
    .where(and(eq(sealRequests.id, sealRequestId), eq(sealRequests.status, from)))
    .returning({ id: sealRequests.id });
  if (updated.length === 0) throw new DomainError("INVALID_STATE", msg);
}

async function loadRequest(deps: Deps, id: string) {
  const [r] = await deps.db
    .select({
      id: sealRequests.id,
      sealType: sealRequests.sealType,
      status: sealRequests.status,
      requestedById: sealRequests.requestedById,
    })
    .from(sealRequests)
    .where(eq(sealRequests.id, id))
    .limit(1);
  if (!r) throw new DomainError("NOT_FOUND", "用印申请不存在");
  return r;
}

export const ApproveSealInput = z.object({
  sealRequestId: z.string().min(1),
  approveNote: z.string().max(500).optional(),
});

export async function approveSealRequest(deps: Deps, auth: AuthContext, rawInput: unknown) {
  const input = ApproveSealInput.parse(rawInput);
  const r = await loadRequest(deps, input.sealRequestId);
  await assertCanApprove(deps, auth, r.sealType as SealType);
  await transition(
    deps,
    input.sealRequestId,
    "PENDING",
    { status: "APPROVED", approvedById: auth.userId, approvedAt: deps.clock.now(), approveNote: input.approveNote ?? null },
    "仅待审批的用印申请可通过",
  );
  await deps.audit.record(auth, {
    action: "SEAL_REQUEST_APPROVE",
    targetType: "SealRequest",
    targetId: input.sealRequestId,
    detail: { sealType: r.sealType },
  });
  return { id: input.sealRequestId, status: "APPROVED" as const };
}

export async function rejectSealRequest(deps: Deps, auth: AuthContext, rawInput: unknown) {
  const input = ApproveSealInput.parse(rawInput);
  const r = await loadRequest(deps, input.sealRequestId);
  await assertCanApprove(deps, auth, r.sealType as SealType);
  await transition(
    deps,
    input.sealRequestId,
    "PENDING",
    { status: "REJECTED", approvedById: auth.userId, rejectedAt: deps.clock.now(), approveNote: input.approveNote ?? null },
    "仅待审批的用印申请可驳回",
  );
  await deps.audit.record(auth, {
    action: "SEAL_REQUEST_REJECT",
    targetType: "SealRequest",
    targetId: input.sealRequestId,
    detail: { sealType: r.sealType, hasNote: (input.approveNote?.length ?? 0) > 0 },
  });
  return { id: input.sealRequestId, status: "REJECTED" as const };
}

export const StampSealInput = z.object({
  sealRequestId: z.string().min(1),
  stampedDocId: z.string().min(1),
});

export async function stampSealRequest(deps: Deps, auth: AuthContext, rawInput: unknown) {
  const input = StampSealInput.parse(rawInput);
  const r = await loadRequest(deps, input.sealRequestId);
  // The seal holder (same authorization as the approver) records the stamping.
  await assertCanApprove(deps, auth, r.sealType as SealType);
  await loadDocument(deps, input.stampedDocId); // 盖章后扫描件必补，必须为有效文件
  try {
    await transition(
      deps,
      input.sealRequestId,
      "APPROVED",
      { status: "STAMPED", stampedById: auth.userId, stampedAt: deps.clock.now(), stampedDocId: input.stampedDocId },
      "仅已批准的用印申请可登记盖章",
    );
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw new DomainError("CONFLICT", "该扫描件已被其他用印申请占用");
  }
  await deps.audit.record(auth, {
    action: "SEAL_REQUEST_STAMP",
    targetType: "SealRequest",
    targetId: input.sealRequestId,
    detail: { sealType: r.sealType },
  });
  return { id: input.sealRequestId, status: "STAMPED" as const };
}

export const CancelSealInput = z.object({ sealRequestId: z.string().min(1) });

export async function cancelSealRequest(deps: Deps, auth: AuthContext, rawInput: unknown) {
  const { sealRequestId } = CancelSealInput.parse(rawInput);
  const r = await loadRequest(deps, sealRequestId);
  // Only the requester (or ADMIN) may cancel, and only before approval.
  if (r.requestedById !== auth.userId && auth.role !== "ADMIN") {
    throw new DomainError("FORBIDDEN", "只能撤销本人的用印申请");
  }
  await transition(deps, sealRequestId, "PENDING", { status: "CANCELLED" }, "仅待审批的用印申请可撤销");
  await deps.audit.record(auth, {
    action: "SEAL_REQUEST_CANCEL",
    targetType: "SealRequest",
    targetId: sealRequestId,
    detail: { sealType: r.sealType },
  });
  return { id: sealRequestId, status: "CANCELLED" as const };
}

// ── reads ─────────────────────────────────────────────────────────────────────
/** Seal types this user can appear as an approver for (own queue scope). */
async function approverScope(deps: Deps, auth: AuthContext): Promise<SealType[]> {
  const base = approvableSealTypes(auth.role).filter((t) => !SEAL_TYPES[t].requiresLegalRep);
  // Legal-rep seals are only visible to the configured legal rep (or ADMIN).
  if (auth.role === "ADMIN") return approvableSealTypes(auth.role);
  const legalRep = await getFirmLegalRepUserId(deps);
  if (legalRep && legalRep === auth.userId) {
    return [...new Set([...base, "LEGAL_REP_SEAL" as SealType])];
  }
  return base;
}

export const ListSealRequestsInput = z.object({
  status: z.enum(["PENDING", "APPROVED", "STAMPED", "REJECTED", "CANCELLED"]).optional(),
});

export async function listSealRequests(deps: Deps, auth: AuthContext, rawInput?: unknown) {
  const input = ListSealRequestsInput.parse(rawInput ?? {});
  // Visibility: own requests + the approval queue for seals this user can approve.
  let visibility;
  if (auth.role === "ADMIN") {
    visibility = undefined; // all
  } else {
    const types = await approverScope(deps, auth);
    visibility = types.length
      ? or(eq(sealRequests.requestedById, auth.userId), inArray(sealRequests.sealType, types))
      : eq(sealRequests.requestedById, auth.userId);
  }
  const statusFilter = input.status ? eq(sealRequests.status, input.status) : undefined;
  const where = and(visibility, statusFilter);
  return await deps.db
    .select()
    .from(sealRequests)
    .where(where)
    .orderBy(desc(sealRequests.requestedAt))
    .limit(200);
}

export async function getSealRequest(deps: Deps, auth: AuthContext, rawInput: { sealRequestId: string }) {
  const [r] = await deps.db.select().from(sealRequests).where(eq(sealRequests.id, rawInput.sealRequestId)).limit(1);
  if (!r) throw new DomainError("NOT_FOUND", "用印申请不存在");
  // Visible to the requester, an eligible approver, or ADMIN.
  if (auth.role !== "ADMIN" && r.requestedById !== auth.userId) {
    const types = await approverScope(deps, auth);
    if (!types.includes(r.sealType as SealType)) throw new DomainError("NOT_FOUND", "用印申请不存在");
  }
  return r;
}

/** Static catalog for the UI / CLI (seal types + their Chinese labels). */
export function listSealTypes() {
  return (Object.keys(SEAL_TYPES) as SealType[]).map((type) => ({
    type,
    label: SEAL_TYPES[type].label,
    requiresLegalRep: SEAL_TYPES[type].requiresLegalRep,
  }));
}

export { isSealType };
