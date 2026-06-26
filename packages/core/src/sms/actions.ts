/**
 * 法院短信解析 inbox (DOMAIN-SPEC §5.6).
 *
 * Paste raw SMS → local regex parse → auto-match to a matter by case number
 * (reverse-lookup MatterProcedure.caseNumber) → one-click spawn a Hearing /
 * Deadline on that matter and mark the message processed.
 *
 * Generation reuses the activity/deadline use cases, so their matter-access and
 * audit guarantees apply; this module only adds parsing, matching and tracking.
 */
import { z } from "zod";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { matterProcedures, matters, smsMessages } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { isManagement, requireRole } from "../permissions.js";
import { assertMatterAccess } from "../matter/access.js";
import { addHearing } from "../activity/actions.js";
import { addDeadline } from "../deadline/actions.js";
import { parseSms, toDate, type ParsedSms } from "./parser.js";

/** Add N calendar days to a date (local), preserving time. */
function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

/** Find the matter (and procedure) whose case number matches the parsed SMS. */
async function autoMatch(deps: Deps, caseNumbers: string[]) {
  if (caseNumbers.length === 0) return null;
  const [proc] = await deps.db
    .select({ matterId: matterProcedures.matterId, procedureId: matterProcedures.id })
    .from(matterProcedures)
    .where(inArray(matterProcedures.caseNumber, caseNumbers))
    .limit(1);
  return proc ?? null;
}

export const IngestSmsInput = z.object({
  rawText: z.string().trim().min(1).max(5000),
  receivedAt: z.coerce.date().optional(),
});

/** Parse + auto-match + store one SMS. The matcher links to ANY matter with the
 * case number; visibility is enforced on read (the receiver always sees it). */
export async function ingestSms(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT");
  const input = IngestSmsInput.parse(rawInput);
  const parsed = parseSms(input.rawText);
  const match = await autoMatch(deps, parsed.caseNumbers);

  const now = deps.clock.now();
  const id = deps.ids.newId();
  await deps.db.insert(smsMessages).values({
    id,
    rawText: input.rawText,
    receivedAt: input.receivedAt ?? now,
    receivedById: auth.userId,
    parsedJson: JSON.stringify(parsed),
    smsType: parsed.smsType,
    matchedMatterId: match?.matterId ?? null,
    matchedBy: match ? "AUTO_CASE_NUMBER" : "UNMATCHED",
    generatedHearingId: null,
    generatedDeadlineId: null,
    processed: false,
    processedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await deps.audit.record(auth, {
    action: "SMS_INGEST",
    targetType: "SmsMessage",
    targetId: id,
    detail: { smsType: parsed.smsType, matched: match ? "AUTO_CASE_NUMBER" : "UNMATCHED" },
  });
  return { id, smsType: parsed.smsType, matchedMatterId: match?.matterId ?? null, parsed };
}

/** Parse-only preview (no persistence) — for a paste dialog. */
export function previewSms(_deps: Deps, _auth: AuthContext, rawInput: { rawText: string }): ParsedSms {
  return parseSms(rawInput.rawText ?? "");
}

function rowWithParsed(r: typeof smsMessages.$inferSelect) {
  let parsed: ParsedSms | null = null;
  try {
    parsed = JSON.parse(r.parsedJson) as ParsedSms;
  } catch {
    parsed = null;
  }
  return { ...r, parsed };
}

export const ListSmsInput = z.object({ processed: z.coerce.boolean().optional() });

export async function listSms(deps: Deps, auth: AuthContext, rawInput?: unknown) {
  const input = ListSmsInput.parse(rawInput ?? {});
  // Visibility: own received messages + (for a LAWYER) messages matched to a
  // matter they own; management sees all. ASSISTANT/FINANCE: own received only.
  let visibility;
  if (isManagement(auth)) {
    visibility = undefined;
  } else if (auth.role === "LAWYER") {
    const ownMatters = deps.db.select({ id: matters.id }).from(matters).where(eq(matters.ownerId, auth.userId));
    visibility = inArray(smsMessages.matchedMatterId, ownMatters);
    // OR own received — combined below.
  }
  const own = eq(smsMessages.receivedById, auth.userId);
  const base = visibility ? or(own, visibility) : isManagement(auth) ? undefined : own;
  const processedFilter = input.processed === undefined ? undefined : eq(smsMessages.processed, input.processed);
  const rows = await deps.db
    .select()
    .from(smsMessages)
    .where(and(base, processedFilter))
    .orderBy(desc(smsMessages.receivedAt))
    .limit(200);
  return rows.map(rowWithParsed);
}

/** Load an SMS the caller may see (receiver, owner of the matched matter, or management). */
async function visibleSms(deps: Deps, auth: AuthContext, smsId: string) {
  const [r] = await deps.db.select().from(smsMessages).where(eq(smsMessages.id, smsId)).limit(1);
  if (!r) throw new DomainError("NOT_FOUND", "短信不存在");
  if (isManagement(auth) || r.receivedById === auth.userId) return r;
  if (r.matchedMatterId) {
    const [m] = await deps.db.select({ ownerId: matters.ownerId }).from(matters).where(eq(matters.id, r.matchedMatterId)).limit(1);
    if (m && m.ownerId === auth.userId) return r;
  }
  throw new DomainError("NOT_FOUND", "短信不存在");
}

export async function getSms(deps: Deps, auth: AuthContext, rawInput: { smsId: string }) {
  const r = await visibleSms(deps, auth, rawInput.smsId);
  return rowWithParsed(r);
}

export const AssignSmsInput = z.object({ smsId: z.string().min(1), matterId: z.string().min(1) });

/** Manually match an SMS to a matter (requires access to that matter). */
export async function assignSmsMatter(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT");
  const input = AssignSmsInput.parse(rawInput);
  const r = await visibleSms(deps, auth, input.smsId);
  const [m] = await deps.db.select({ ownerId: matters.ownerId }).from(matters).where(eq(matters.id, input.matterId)).limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  assertMatterAccess(m, auth);
  await deps.db
    .update(smsMessages)
    .set({ matchedMatterId: input.matterId, matchedBy: "MANUAL", updatedAt: deps.clock.now() })
    .where(eq(smsMessages.id, r.id));
  await deps.audit.record(auth, {
    action: "SMS_ASSIGN_MATTER",
    targetType: "SmsMessage",
    targetId: r.id,
    detail: { matterId: input.matterId },
  });
  return { id: r.id, matchedMatterId: input.matterId, matchedBy: "MANUAL" as const };
}

/** Resolve the procedure to attach generated items to: an explicit id, else the
 * procedure in the matched matter whose case number the SMS referenced. */
async function resolveProcedure(deps: Deps, matterId: string, parsed: ParsedSms, explicit?: string) {
  if (explicit) return explicit;
  if (parsed.caseNumbers.length) {
    const [p] = await deps.db
      .select({ id: matterProcedures.id })
      .from(matterProcedures)
      .where(and(eq(matterProcedures.matterId, matterId), inArray(matterProcedures.caseNumber, parsed.caseNumbers)))
      .limit(1);
    if (p) return p.id;
  }
  throw new DomainError("VALIDATION", "无法确定程序，请指定 procedureId");
}

export const GenerateHearingInput = z.object({
  smsId: z.string().min(1),
  procedureId: z.string().min(1).optional(),
  title: z.string().max(200).optional(),
  startsAt: z.coerce.date().optional(),
});

/** One-click: create a Hearing on the matched matter from the parsed hearing time. */
export async function generateHearingFromSms(deps: Deps, auth: AuthContext, rawInput: unknown) {
  const input = GenerateHearingInput.parse(rawInput);
  const r = await visibleSms(deps, auth, input.smsId);
  if (!r.matchedMatterId) throw new DomainError("INVALID_STATE", "短信未关联案件，请先匹配案件");
  const parsed = rowWithParsed(r).parsed;
  if (!parsed) throw new DomainError("INVALID_STATE", "短信解析结果缺失");

  const startsAt = input.startsAt ?? (parsed.hearingDate ? toDate(parsed.hearingDate) : null);
  if (!startsAt) throw new DomainError("VALIDATION", "短信中未识别到开庭时间，请手动指定");
  const procedureId = await resolveProcedure(deps, r.matchedMatterId, parsed, input.procedureId);

  // addHearing enforces matter write access + audits; we just thread the data.
  const hearing = await addHearing(deps, auth, {
    procedureId,
    title: input.title ?? `开庭（${parsed.court ?? "法院"}）`,
    startsAt,
    room: parsed.courtRoom ?? undefined,
    judge: parsed.judge ?? undefined,
  });
  await deps.db
    .update(smsMessages)
    .set({ generatedHearingId: hearing.id, processed: true, processedAt: deps.clock.now(), updatedAt: deps.clock.now() })
    .where(eq(smsMessages.id, r.id));
  await deps.audit.record(auth, {
    action: "SMS_GENERATE_HEARING",
    targetType: "SmsMessage",
    targetId: r.id,
    detail: { matterId: r.matchedMatterId, hearingId: hearing.id },
  });
  return { id: r.id, hearingId: hearing.id, processed: true };
}

export const GenerateDeadlineInput = z.object({
  smsId: z.string().min(1),
  procedureId: z.string().min(1).optional(),
  title: z.string().max(200).optional(),
  dueAt: z.coerce.date().optional(),
  category: z.string().max(40).optional(),
});

/** One-click: create a Deadline on the matched matter. Due date is taken from the
 * explicit input, else derived from the parsed appeal window (judgment/filing
 * date + N days). */
export async function generateDeadlineFromSms(deps: Deps, auth: AuthContext, rawInput: unknown) {
  const input = GenerateDeadlineInput.parse(rawInput);
  const r = await visibleSms(deps, auth, input.smsId);
  if (!r.matchedMatterId) throw new DomainError("INVALID_STATE", "短信未关联案件，请先匹配案件");
  const parsed = rowWithParsed(r).parsed;
  if (!parsed) throw new DomainError("INVALID_STATE", "短信解析结果缺失");

  let dueAt = input.dueAt ?? null;
  if (!dueAt && parsed.appealDeadline) {
    const days = parseInt(parsed.appealDeadline, 10);
    const base = (parsed.judgmentDate && toDate(parsed.judgmentDate)) || (parsed.filingDate && toDate(parsed.filingDate));
    if (Number.isFinite(days) && base) dueAt = addDays(base, days);
  }
  if (!dueAt) throw new DomainError("VALIDATION", "无法确定到期日，请手动指定");
  const procedureId = await resolveProcedure(deps, r.matchedMatterId, parsed, input.procedureId);

  const deadline = await addDeadline(deps, auth, {
    procedureId,
    title: input.title ?? (parsed.appealDeadline ? "上诉期限" : "短信生成期限"),
    dueAt,
    category: input.category ?? "CUSTOM",
    basis: parsed.summary,
  });
  await deps.db
    .update(smsMessages)
    .set({ generatedDeadlineId: deadline.id, processed: true, processedAt: deps.clock.now(), updatedAt: deps.clock.now() })
    .where(eq(smsMessages.id, r.id));
  await deps.audit.record(auth, {
    action: "SMS_GENERATE_DEADLINE",
    targetType: "SmsMessage",
    targetId: r.id,
    detail: { matterId: r.matchedMatterId, deadlineId: deadline.id },
  });
  return { id: r.id, deadlineId: deadline.id, processed: true };
}

export const MarkSmsProcessedInput = z.object({
  smsId: z.string().min(1),
  processed: z.coerce.boolean().default(true),
});

export async function markSmsProcessed(deps: Deps, auth: AuthContext, rawInput: unknown) {
  const input = MarkSmsProcessedInput.parse(rawInput);
  const r = await visibleSms(deps, auth, input.smsId);
  await deps.db
    .update(smsMessages)
    .set({
      processed: input.processed,
      processedAt: input.processed ? deps.clock.now() : null,
      updatedAt: deps.clock.now(),
    })
    .where(eq(smsMessages.id, r.id));
  return { id: r.id, processed: input.processed };
}
