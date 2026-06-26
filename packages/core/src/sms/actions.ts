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
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { matterProcedures, matters, smsMessages } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { isManagement, requireRole } from "../permissions.js";
import { assertMatterAccess } from "../matter/access.js";
import { assertMatterWritable } from "../matter/guards.js";
import { addHearing } from "../activity/actions.js";
import { addDeadline } from "../deadline/actions.js";
import { parseSms, toDate, type ParsedSms } from "./parser.js";

/** Add N calendar days to a date (local), preserving time. */
function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

/** Auto-match a matter by case number — ONLY when unambiguous. caseNumber has no
 * uniqueness constraint, so if the parsed numbers resolve to two+ distinct
 * matters we leave the SMS UNMATCHED (manual assignment) rather than guess and
 * risk leaking the message to the wrong matter owner. */
async function autoMatch(deps: Deps, caseNumbers: string[]): Promise<string | null> {
  if (caseNumbers.length === 0) return null;
  const candidates = await deps.db
    .selectDistinct({ matterId: matterProcedures.matterId })
    .from(matterProcedures)
    .where(inArray(matterProcedures.caseNumber, caseNumbers))
    .limit(2);
  return candidates.length === 1 ? candidates[0].matterId : null;
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
  const matchedMatterId = await autoMatch(deps, parsed.caseNumbers);

  const now = deps.clock.now();
  const id = deps.ids.newId();
  await deps.db.insert(smsMessages).values({
    id,
    rawText: input.rawText,
    receivedAt: input.receivedAt ?? now,
    receivedById: auth.userId,
    parsedJson: JSON.stringify(parsed),
    smsType: parsed.smsType,
    matchedMatterId,
    matchedBy: matchedMatterId ? "AUTO_CASE_NUMBER" : "UNMATCHED",
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
    detail: { smsType: parsed.smsType, matched: matchedMatterId ? "AUTO_CASE_NUMBER" : "UNMATCHED" },
  });
  return { id, smsType: parsed.smsType, matchedMatterId, parsed };
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
  // Same predicate as listSms: only a LAWYER who OWNS the matched matter gets the
  // SMS via the matter (ASSISTANT/FINANCE: own-received only). Keeps list and get
  // — and the mutations gated by visibleSms — consistent.
  if (auth.role === "LAWYER" && r.matchedMatterId) {
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
  if (explicit) {
    // An explicit procedure MUST belong to the SMS's matched matter — otherwise a
    // user could generate a hearing/deadline on an unrelated matter they happen to
    // edit, from this SMS's content. If the SMS is for another case, re-assign first.
    const [p] = await deps.db
      .select({ matterId: matterProcedures.matterId })
      .from(matterProcedures)
      .where(eq(matterProcedures.id, explicit))
      .limit(1);
    if (!p) throw new DomainError("NOT_FOUND", "程序不存在");
    if (p.matterId !== matterId) throw new DomainError("VALIDATION", "程序不属于该短信关联的案件");
    return explicit;
  }
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

/** Replicate the downstream addHearing/addDeadline preconditions BEFORE we claim
 * the SMS, so a doomed generation never marks the message processed: the target
 * procedure must be ENGAGED (not INFORMATIONAL) and its matter writable (access +
 * not archived). The role check is done per-action by the caller (the hearing and
 * deadline use cases allow different role sets). */
async function assertGeneratableProcedure(deps: Deps, auth: AuthContext, procedureId: string) {
  const [p] = await deps.db
    .select({ engagement: matterProcedures.engagement, matterId: matterProcedures.matterId })
    .from(matterProcedures)
    .where(eq(matterProcedures.id, procedureId))
    .limit(1);
  if (!p) throw new DomainError("NOT_FOUND", "程序不存在");
  if (p.engagement === "INFORMATIONAL") {
    throw new DomainError("VALIDATION", "前序参考程序不进入日程聚合，不能生成开庭/期限");
  }
  await assertMatterWritable(deps.db, auth, p.matterId); // access + not archived
}

export const GenerateHearingInput = z.object({
  smsId: z.string().min(1),
  procedureId: z.string().min(1).optional(),
  title: z.string().max(200).optional(),
  startsAt: z.coerce.date().optional(),
});

/** One-click: create a Hearing on the matched matter from the parsed hearing time. */
export async function generateHearingFromSms(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT"); // mirror addHearing
  const input = GenerateHearingInput.parse(rawInput);
  const r = await visibleSms(deps, auth, input.smsId);
  if (!r.matchedMatterId) throw new DomainError("INVALID_STATE", "短信未关联案件，请先匹配案件");
  const parsed = rowWithParsed(r).parsed;
  if (!parsed) throw new DomainError("INVALID_STATE", "短信解析结果缺失");

  const startsAt = input.startsAt ?? (parsed.hearingDate ? toDate(parsed.hearingDate) : null);
  if (!startsAt) throw new DomainError("VALIDATION", "短信中未识别到开庭时间，请手动指定");
  const procedureId = await resolveProcedure(deps, r.matchedMatterId, parsed, input.procedureId);
  await assertGeneratableProcedure(deps, auth, procedureId); // all addHearing preconditions, pre-claim

  // Atomically CLAIM the SMS before creating anything: flip processed false→true
  // in one guarded statement. A re-click or concurrent request matches 0 rows and
  // bails — so one SMS spawns at most one generated record (no duplicates). All
  // validation above ran first, so a failed validation never wrongly marks it
  // processed. (If addHearing below fails, the SMS is processed with no hearing —
  // recoverable via markSmsProcessed undo; still no duplicate.)
  const now = deps.clock.now();
  const claimed = await deps.db
    .update(smsMessages)
    .set({ processed: true, processedAt: now, updatedAt: now })
    .where(and(eq(smsMessages.id, r.id), eq(smsMessages.processed, false)))
    .returning({ id: smsMessages.id });
  if (claimed.length === 0) throw new DomainError("INVALID_STATE", "该短信已处理，无法重复生成");

  // addHearing enforces matter write access + audits; we just thread the data.
  // If it throws (e.g. the matter was archived in the race window AFTER our
  // preflight), roll the claim back so the SMS is retryable — but only while no
  // generated id was written, so a success is never un-processed.
  let hearing: { id: string };
  try {
    hearing = await addHearing(deps, auth, {
      procedureId,
      title: input.title ?? `开庭（${parsed.court ?? "法院"}）`,
      startsAt,
      room: parsed.courtRoom ?? undefined,
      judge: parsed.judge ?? undefined,
    });
  } catch (err) {
    await deps.db
      .update(smsMessages)
      .set({ processed: false, processedAt: null, updatedAt: deps.clock.now() })
      .where(and(eq(smsMessages.id, r.id), isNull(smsMessages.generatedHearingId)));
    throw err;
  }
  await deps.db
    .update(smsMessages)
    .set({ generatedHearingId: hearing.id, updatedAt: deps.clock.now() })
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
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER"); // mirror addDeadline (no ASSISTANT)
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
  await assertGeneratableProcedure(deps, auth, procedureId); // all addDeadline preconditions, pre-claim

  // Atomic claim before creating — same idempotency guard as gen-hearing.
  const now = deps.clock.now();
  const claimed = await deps.db
    .update(smsMessages)
    .set({ processed: true, processedAt: now, updatedAt: now })
    .where(and(eq(smsMessages.id, r.id), eq(smsMessages.processed, false)))
    .returning({ id: smsMessages.id });
  if (claimed.length === 0) throw new DomainError("INVALID_STATE", "该短信已处理，无法重复生成");

  // Roll the claim back if creation throws in the race window — same retryable
  // guard as gen-hearing (only while no generated id was written).
  let deadline: { id: string };
  try {
    deadline = await addDeadline(deps, auth, {
      procedureId,
      title: input.title ?? (parsed.appealDeadline ? "上诉期限" : "短信生成期限"),
      dueAt,
      category: input.category ?? "CUSTOM",
      basis: parsed.summary,
    });
  } catch (err) {
    await deps.db
      .update(smsMessages)
      .set({ processed: false, processedAt: null, updatedAt: deps.clock.now() })
      .where(and(eq(smsMessages.id, r.id), isNull(smsMessages.generatedDeadlineId)));
    throw err;
  }
  await deps.db
    .update(smsMessages)
    .set({ generatedDeadlineId: deadline.id, updatedAt: deps.clock.now() })
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
