/**
 * 开票工作流 (InvoiceRequest, DOMAIN-SPEC §5.4).
 *
 * PENDING → APPROVED → ISSUED, side branch REJECTED.
 * - [matter lead / management] request (amount + buyer + evidence docs[required])
 * - [FINANCE / ADMIN / PRINCIPAL_LAWYER] approve / reject; then issue (invoice no
 *   + electronic-invoice Document[required]) → ISSUED.
 *
 * Evidence/contract/invoice files are Document ids; a matter-bound invoice's docs
 * must belong to that matter (no cross-matter attachment). Transitions are
 * predicate-guarded for concurrency. Amount math is integer cents.
 */
import { z } from "zod";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { documents, invoiceRequests, matters } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps, type InvoiceRequestStatus } from "../types.js";
import { isManagement, requireRole } from "../permissions.js";
import { assertMatterAccess, assertMatterOwnerAccess } from "../matter/access.js";
import { enqueueNotification } from "../notification/actions.js";

const AMOUNT = z.string().regex(/^\d+(\.\d{1,2})?$/, "金额格式应为最多两位小数");
const FINANCE_ROLES = ["ADMIN", "PRINCIPAL_LAWYER", "FINANCE"] as const;

/** Load Documents (non-deleted) and assert they all exist and — when the invoice
 * is matter-bound — belong to that matter. Returns nothing; throws on violation. */
async function assertDocsInMatter(deps: Deps, docIds: string[], matterId: string | null) {
  if (docIds.length === 0) return;
  const rows = await deps.db
    .select({ id: documents.id, matterId: documents.matterId })
    .from(documents)
    .where(and(inArray(documents.id, docIds), isNull(documents.deletedAt)));
  if (rows.length !== new Set(docIds).size) throw new DomainError("VALIDATION", "开票依据文件不存在或已删除");
  if (matterId && rows.some((r) => r.matterId !== matterId)) {
    throw new DomainError("VALIDATION", "开票文件不属于该案件");
  }
}

// ── create ────────────────────────────────────────────────────────────────────
export const CreateInvoiceInput = z
  .object({
    matterId: z.string().min(1).optional(),
    noMatterReason: z.string().max(300).optional(),
    amount: AMOUNT,
    invoiceType: z.enum(["PLAIN", "SPECIAL"]).optional(),
    invoiceItem: z.enum(["LAWYER_FEE", "CONSULTING_FEE", "AGENCY_FEE", "OTHER"]).optional(),
    buyerName: z.string().max(200).optional(),
    buyerTaxNo: z.string().max(60).optional(),
    buyerAddress: z.string().max(300).optional(),
    buyerPhone: z.string().max(40).optional(),
    buyerBank: z.string().max(120).optional(),
    buyerBankAccount: z.string().max(60).optional(),
    evidenceDocIds: z.array(z.string().min(1)).min(1, "开票依据附件必传").max(20),
    requestNote: z.string().max(500).optional(),
  })
  .refine((v) => v.matterId || (v.noMatterReason && v.noMatterReason.trim().length > 0), {
    message: "无关联案件时必须填写原因",
    path: ["noMatterReason"],
  });

export async function createInvoiceRequest(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER");
  const input = CreateInvoiceInput.parse(rawInput);

  if (input.matterId) {
    const [m] = await deps.db.select({ id: matters.id, ownerId: matters.ownerId }).from(matters).where(eq(matters.id, input.matterId)).limit(1);
    if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
    assertMatterOwnerAccess(m, auth); // 主办 (owner) or management — matches the read side
  }
  // 增值税专用发票（税法）：购方"六要素"——名称 + 税号 + 地址 + 电话 + 开户行 + 账号——全部必填。
  if (input.invoiceType === "SPECIAL") {
    const missing = [input.buyerName, input.buyerTaxNo, input.buyerAddress, input.buyerPhone, input.buyerBank, input.buyerBankAccount].some(
      (v) => !v || String(v).trim().length === 0,
    );
    if (missing) throw new DomainError("VALIDATION", "增值税专用发票须填写购方名称、税号、地址、电话、开户行、账号");
  }
  await assertDocsInMatter(deps, input.evidenceDocIds, input.matterId ?? null);
  // Matterless invoice: there's no invoice matter to gate on, so the requester
  // must still be able to access EACH evidence document's own matter — otherwise
  // a LAWYER could embed another case's documents as 开票依据.
  if (!input.matterId) {
    const docRows = await deps.db
      .select({ matterId: documents.matterId })
      .from(documents)
      .where(inArray(documents.id, input.evidenceDocIds));
    const distinctMatters = [...new Set(docRows.map((d) => d.matterId).filter((x): x is string => !!x))];
    if (distinctMatters.length) {
      const ms = await deps.db.select({ id: matters.id, ownerId: matters.ownerId }).from(matters).where(inArray(matters.id, distinctMatters));
      const byId = new Map(ms.map((m) => [m.id, m]));
      for (const mid of distinctMatters) {
        const m = byId.get(mid);
        if (!m) throw new DomainError("NOT_FOUND", "开票依据文件不存在");
        await assertMatterAccess(deps.db, m, auth); // throws NOT_FOUND if the requester can't access it
      }
    }
  }

  const now = deps.clock.now();
  const id = deps.ids.newId();
  await deps.db.insert(invoiceRequests).values({
    id,
    matterId: input.matterId ?? null,
    noMatterReason: input.matterId ? null : (input.noMatterReason ?? null),
    amount: input.amount,
    title: input.buyerName ?? null,
    status: "PENDING",
    requestNote: input.requestNote ?? null,
    invoiceType: input.invoiceType ?? null,
    invoiceItem: input.invoiceItem ?? null,
    buyerName: input.buyerName ?? null,
    buyerTaxNo: input.buyerTaxNo ?? null,
    buyerAddress: input.buyerAddress ?? null,
    buyerPhone: input.buyerPhone ?? null,
    buyerBank: input.buyerBank ?? null,
    buyerBankAccount: input.buyerBankAccount ?? null,
    evidenceDocIdsJson: JSON.stringify(input.evidenceDocIds),
    invoiceNo: null,
    issuedAt: null,
    requestedById: auth.userId,
    requestedAt: now,
    processedById: null,
    processedAt: null,
    processNote: null,
    contractScanId: null,
    invoiceFileId: null,
    createdAt: now,
    updatedAt: now,
  });
  await deps.audit.record(auth, {
    action: "INVOICE_REQUEST_CREATE",
    targetType: "InvoiceRequest",
    targetId: id,
    detail: { matterId: input.matterId ?? null, amount: input.amount, invoiceType: input.invoiceType ?? null },
  });
  return { id, status: "PENDING" as const };
}

// ── transitions ────────────────────────────────────────────────────────────
async function loadInvoice(deps: Deps, id: string) {
  const [r] = await deps.db
    .select({ id: invoiceRequests.id, status: invoiceRequests.status, matterId: invoiceRequests.matterId, requestedById: invoiceRequests.requestedById })
    .from(invoiceRequests)
    .where(eq(invoiceRequests.id, id))
    .limit(1);
  if (!r) throw new DomainError("NOT_FOUND", "开票申请不存在");
  return r;
}

async function transition(deps: Deps, id: string, from: string, set: Record<string, unknown>, msg: string) {
  const updated = await deps.db
    .update(invoiceRequests)
    .set({ ...set, updatedAt: deps.clock.now() })
    .where(and(eq(invoiceRequests.id, id), eq(invoiceRequests.status, from)))
    .returning({ id: invoiceRequests.id });
  if (updated.length === 0) throw new DomainError("INVALID_STATE", msg);
}

async function notifyRequester(deps: Deps, auth: AuthContext, r: { requestedById: string; id: string }, title: string, priority: "NORMAL" | "HIGH") {
  if (r.requestedById === auth.userId) return;
  await enqueueNotification(deps, {
    userId: r.requestedById,
    type: "SYSTEM",
    priority,
    title,
    href: "/finance",
    refType: "InvoiceRequest",
    refId: r.id,
  });
}

export const ProcessInvoiceInput = z.object({ invoiceRequestId: z.string().min(1), processNote: z.string().max(500).optional() });

export async function approveInvoice(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, ...FINANCE_ROLES);
  const input = ProcessInvoiceInput.parse(rawInput);
  const r = await loadInvoice(deps, input.invoiceRequestId);
  await transition(deps, r.id, "PENDING", { status: "APPROVED", processedById: auth.userId, processedAt: deps.clock.now(), processNote: input.processNote ?? null }, "仅待处理的开票申请可批准");
  await deps.audit.record(auth, { action: "INVOICE_REQUEST_APPROVE", targetType: "InvoiceRequest", targetId: r.id, detail: {} });
  await notifyRequester(deps, auth, r, "开票申请已批准，待开具", "NORMAL");
  return { id: r.id, status: "APPROVED" as const };
}

export async function rejectInvoice(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, ...FINANCE_ROLES);
  const input = ProcessInvoiceInput.parse(rawInput);
  const r = await loadInvoice(deps, input.invoiceRequestId);
  await transition(deps, r.id, "PENDING", { status: "REJECTED", processedById: auth.userId, processedAt: deps.clock.now(), processNote: input.processNote ?? null }, "仅待处理的开票申请可驳回");
  await deps.audit.record(auth, { action: "INVOICE_REQUEST_REJECT", targetType: "InvoiceRequest", targetId: r.id, detail: { hasNote: (input.processNote?.length ?? 0) > 0 } });
  await notifyRequester(deps, auth, r, "开票申请被驳回", "HIGH");
  return { id: r.id, status: "REJECTED" as const };
}

export const IssueInvoiceInput = z.object({
  invoiceRequestId: z.string().min(1),
  invoiceNo: z.string().trim().min(1).max(64),
  invoiceFileId: z.string().min(1), // 电子发票（必传）
  contractScanId: z.string().min(1).optional(),
});

export async function issueInvoice(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, ...FINANCE_ROLES);
  const input = IssueInvoiceInput.parse(rawInput);
  const r = await loadInvoice(deps, input.invoiceRequestId);
  // The uploaded files must be valid and (for a matter-bound invoice) in-matter.
  const fileIds = [input.invoiceFileId, ...(input.contractScanId ? [input.contractScanId] : [])];
  await assertDocsInMatter(deps, fileIds, r.matterId);
  try {
    await transition(
      deps,
      r.id,
      "APPROVED",
      {
        status: "ISSUED",
        invoiceNo: input.invoiceNo,
        invoiceFileId: input.invoiceFileId,
        contractScanId: input.contractScanId ?? null,
        issuedAt: deps.clock.now(),
      },
      "仅已批准的开票申请可开具",
    );
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw new DomainError("CONFLICT", "该发票文件已被其他开票申请占用");
  }
  await deps.audit.record(auth, { action: "INVOICE_REQUEST_ISSUE", targetType: "InvoiceRequest", targetId: r.id, detail: {} });
  await notifyRequester(deps, auth, r, "发票已开具", "NORMAL");
  return { id: r.id, status: "ISSUED" as const };
}

// ── reads ─────────────────────────────────────────────────────────────────────
export const ListInvoicesInput = z.object({
  status: z.enum(["PENDING", "APPROVED", "ISSUED", "REJECTED"]).optional(),
});

export async function listInvoiceRequests(deps: Deps, auth: AuthContext, rawInput?: unknown) {
  const input = ListInvoicesInput.parse(rawInput ?? {});
  // FINANCE + management see the whole queue; a LAWYER sees their own requests +
  // invoices on matters they own.
  let visibility;
  if (isManagement(auth) || auth.role === "FINANCE") {
    visibility = undefined;
  } else {
    const ownMatters = deps.db.select({ id: matters.id }).from(matters).where(eq(matters.ownerId, auth.userId));
    visibility = or(eq(invoiceRequests.requestedById, auth.userId), inArray(invoiceRequests.matterId, ownMatters));
  }
  const where = and(visibility, input.status ? eq(invoiceRequests.status, input.status) : undefined);
  return await deps.db
    .select()
    .from(invoiceRequests)
    .where(where)
    .orderBy(desc(invoiceRequests.requestedAt))
    .limit(200);
}

export async function getInvoiceRequest(deps: Deps, auth: AuthContext, rawInput: { invoiceRequestId: string }) {
  const [r] = await deps.db.select().from(invoiceRequests).where(eq(invoiceRequests.id, rawInput.invoiceRequestId)).limit(1);
  if (!r) throw new DomainError("NOT_FOUND", "开票申请不存在");
  if (!(isManagement(auth) || auth.role === "FINANCE" || r.requestedById === auth.userId)) {
    // A non-finance LAWYER may also see invoices on a matter they own.
    let ok = false;
    if (r.matterId) {
      const [m] = await deps.db.select({ ownerId: matters.ownerId }).from(matters).where(eq(matters.id, r.matterId)).limit(1);
      ok = !!m && m.ownerId === auth.userId;
    }
    if (!ok) throw new DomainError("NOT_FOUND", "开票申请不存在");
  }
  return { ...r, evidenceDocIds: JSON.parse(r.evidenceDocIdsJson) as string[] };
}

export type { InvoiceRequestStatus };
