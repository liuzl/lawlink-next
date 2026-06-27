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
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { deadlines, hearings, matterProcedures, matters, smsMessages } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { isManagement, requireRole } from "../permissions.js";
import { assertMatterAccess, canAccessMatter, matterVisibilityCondition, matterWriteAccessExists } from "../matter/access.js";
import { assertMatterWritable } from "../matter/guards.js";
import { parseSms, toDate, type ParsedSms } from "./parser.js";

/** Bind deps to a transaction handle: the db AND a tx-scoped audit sink, so a
 * nested use case's writes (incl. its audit row) all land in the same txn and
 * roll back together. addHearing/addDeadline open no nested txn and never call
 * batch(), so the cast is safe at runtime. */
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
  // Visibility: own received messages + messages matched to a matter the caller
  // can access (owned OR team member, per matterVisibilityCondition); management
  // sees all. FINANCE / non-member: own received only.
  const own = eq(smsMessages.receivedById, auth.userId);
  const vis = await matterVisibilityCondition(deps.db, auth);
  let base;
  if (isManagement(auth)) {
    base = undefined; // sees all
  } else if (vis === null) {
    base = own; // no visible matters → only own received SMS
  } else {
    const visibleMatters = deps.db.select({ id: matters.id }).from(matters).where(vis);
    base = or(own, inArray(smsMessages.matchedMatterId, visibleMatters));
  }
  const processedFilter = input.processed === undefined ? undefined : eq(smsMessages.processed, input.processed);
  const rows = await deps.db
    .select()
    .from(smsMessages)
    .where(and(base, processedFilter))
    .orderBy(desc(smsMessages.receivedAt))
    .limit(200);
  return rows.map(rowWithParsed);
}

/** Load an SMS the caller may see (receiver, a member of the matched matter, or management). */
async function visibleSms(deps: Deps, auth: AuthContext, smsId: string) {
  const [r] = await deps.db.select().from(smsMessages).where(eq(smsMessages.id, smsId)).limit(1);
  if (!r) throw new DomainError("NOT_FOUND", "短信不存在");
  if (isManagement(auth) || r.receivedById === auth.userId) return r;
  // Same predicate as listSms: the caller gets the SMS via its matched matter if
  // they can access that matter (owner OR team member). Keeps list and get — and
  // the generate-hearing/deadline mutations gated by visibleSms — consistent.
  if (r.matchedMatterId) {
    const [m] = await deps.db.select({ id: matters.id, ownerId: matters.ownerId }).from(matters).where(eq(matters.id, r.matchedMatterId)).limit(1);
    if (m && (await canAccessMatter(deps.db, m, auth))) return r;
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
  // Once a hearing/deadline was generated from this SMS, its matchedMatterId is
  // the case those records live on — re-pointing it would make the back-reference
  // lie. Block reassignment after generation.
  if (r.generatedHearingId || r.generatedDeadlineId) {
    throw new DomainError("INVALID_STATE", "该短信已生成开庭/期限，不能再改派案件");
  }
  const [m] = await deps.db.select({ id: matters.id, ownerId: matters.ownerId }).from(matters).where(eq(matters.id, input.matterId)).limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  await assertMatterAccess(deps.db, m, auth);
  // Guard the WRITE (not just the earlier read) on no generated record, so a
  // generation committing between visibleSms and here can't be overwritten by a
  // stale reassignment — the update matches 0 rows and we reject.
  const updated = await deps.db
    .update(smsMessages)
    .set({ matchedMatterId: input.matterId, matchedBy: "MANUAL", updatedAt: deps.clock.now() })
    .where(and(eq(smsMessages.id, r.id), isNull(smsMessages.generatedHearingId), isNull(smsMessages.generatedDeadlineId)))
    .returning({ id: smsMessages.id });
  if (updated.length === 0) {
    throw new DomainError("INVALID_STATE", "该短信已生成开庭/期限，不能再改派案件");
  }
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
  title: z.string().trim().min(1).max(200).optional(),
  startsAt: z.coerce.date().optional(),
});

/** One-click: create a Hearing on the matched matter from the parsed hearing time. */
export async function generateHearingFromSms(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT"); // mirror addHearing
  const input = GenerateHearingInput.parse(rawInput);
  const r = await visibleSms(deps, auth, input.smsId);
  if (!r.matchedMatterId) throw new DomainError("INVALID_STATE", "短信未关联案件，请先匹配案件");
  const matchedMatterId = r.matchedMatterId; // narrowed; pinned into the claim predicate
  const parsed = rowWithParsed(r).parsed;
  if (!parsed) throw new DomainError("INVALID_STATE", "短信解析结果缺失");

  const startsAt = input.startsAt ?? (parsed.hearingDate ? toDate(parsed.hearingDate) : null);
  if (!startsAt) throw new DomainError("VALIDATION", "短信中未识别到开庭时间，请手动指定");
  const procedureId = await resolveProcedure(deps, r.matchedMatterId, parsed, input.procedureId);
  await assertGeneratableProcedure(deps, auth, procedureId); // all addHearing preconditions, pre-claim

  // Claim + create + back-reference in ONE batch() — a single transaction on
  // libSQL AND D1 (D1 has no interactive transactions) — so there is no window in
  // which a hearing exists while the SMS link is still NULL. addHearing is inlined
  // (its insert + its engagement/writable checks) as a guarded write rather than
  // called as a sub-action, since a sub-action can't run inside a batch.
  //  - `writeGuard` re-checks at WRITE time that the procedure is still ENGAGED on
  //    the resolved matter AND the caller still has write access (matter not
  //    archived / access not lost) — addHearing's engagedProcedureMatter, atomic.
  //  - `smsClaimable` pins processed=false, no hearing yet, AND matchedMatterId to
  //    the value we resolved against (a concurrent assignSmsMatter can't land a
  //    hearing on the old matter); re-click/concurrent/undo→regenerate all fail.
  // The hearing insert runs FIRST (guarded by both), then the claim (same guards)
  // returns 0 rows and bails if anything changed, then the back-ref fires only if
  // the hearing was actually inserted (exists(hearing)). So a failed guard cascades
  // all three to no-ops — never a hearing without its SMS link, or vice versa.
  const now = deps.clock.now();
  const nowSec = Math.floor(now.getTime() / 1000);
  const startsSec = Math.floor(startsAt.getTime() / 1000);
  const hearingId = deps.ids.newId();
  const hearingTitle = input.title ?? `开庭（${parsed.court ?? "法院"}）`;
  const writeGuard = sql`exists (select 1 from "MatterProcedure" p where p."id" = ${procedureId} and p."engagement" = 'ENGAGED' and p."matter_id" = ${matchedMatterId}) and ${matterWriteAccessExists(auth, matchedMatterId)}`;
  const smsClaimable = and(
    eq(smsMessages.id, r.id),
    eq(smsMessages.processed, false),
    isNull(smsMessages.generatedHearingId),
    eq(smsMessages.matchedMatterId, matchedMatterId),
  );

  const hearingInsert = deps.db.insert(hearings).select(sql`
    select ${hearingId}, ${procedureId}, ${matchedMatterId}, ${hearingTitle}, ${parsed.courtRoom ?? null}, null, ${parsed.judge ?? null}, ${startsSec}, null, null, ${nowSec}
    where exists (select 1 from "SmsMessage" where "id" = ${r.id} and "processed" = 0 and "generated_hearing_id" is null and "matched_matter_id" = ${matchedMatterId}) and ${writeGuard}
  `);
  const claim = deps.db
    .update(smsMessages)
    .set({ processed: true, processedAt: now, updatedAt: now })
    .where(and(smsClaimable, writeGuard))
    .returning({ id: smsMessages.id });
  const backRef = deps.db
    .update(smsMessages)
    .set({ generatedHearingId: hearingId, updatedAt: now })
    .where(and(eq(smsMessages.id, r.id), sql`exists (select 1 from "Hearing" where "id" = ${hearingId})`));

  const results = await deps.db.batch([hearingInsert, claim, backRef]);
  if ((results[1] as unknown[]).length === 0) {
    throw new DomainError("INVALID_STATE", "该短信已处理、已生成开庭、关联案件已变更或案件已归档，无法生成");
  }
  await deps.audit.record(auth, {
    action: "HEARING_CREATE",
    targetType: "Hearing",
    targetId: hearingId,
    detail: { matterId: matchedMatterId, procedureId, startsAt: startsAt.toISOString() },
  });
  await deps.audit.record(auth, {
    action: "SMS_GENERATE_HEARING",
    targetType: "SmsMessage",
    targetId: r.id,
    detail: { matterId: r.matchedMatterId, hearingId },
  });
  return { id: r.id, hearingId, processed: true };
}

export const GenerateDeadlineInput = z.object({
  smsId: z.string().min(1),
  procedureId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(200).optional(),
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
  const matchedMatterId = r.matchedMatterId; // narrowed; pinned into the claim predicate
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

  // Claim + create + back-reference in ONE batch() (see generateHearingFromSms):
  // a single transaction on libSQL AND D1 (D1 has no interactive transactions),
  // addDeadline inlined as a guarded write. writeGuard re-checks ENGAGED procedure
  // + write access at write time; smsClaimable pins processed=false, no deadline
  // yet, and matchedMatterId. The deadline insert runs first (both guards), the
  // claim (same guards) returns 0 and bails on any change, the back-ref fires only
  // if the deadline was inserted — never a deadline without its SMS link, or vice
  // versa. epoch seconds.
  const now = deps.clock.now();
  const nowSec = Math.floor(now.getTime() / 1000);
  const dueSec = Math.floor(dueAt.getTime() / 1000);
  const deadlineId = deps.ids.newId();
  const deadlineTitle = input.title ?? (parsed.appealDeadline ? "上诉期限" : "短信生成期限");
  const deadlineCategory = input.category ?? "CUSTOM";
  const writeGuard = sql`exists (select 1 from "MatterProcedure" p where p."id" = ${procedureId} and p."engagement" = 'ENGAGED' and p."matter_id" = ${matchedMatterId}) and ${matterWriteAccessExists(auth, matchedMatterId)}`;
  const smsClaimable = and(
    eq(smsMessages.id, r.id),
    eq(smsMessages.processed, false),
    isNull(smsMessages.generatedDeadlineId),
    eq(smsMessages.matchedMatterId, matchedMatterId),
  );

  const deadlineInsert = deps.db.insert(deadlines).select(sql`
    select ${deadlineId}, ${procedureId}, ${matchedMatterId}, ${deadlineCategory}, ${deadlineTitle}, ${dueSec}, ${parsed.summary ?? null}, null, 0, 0, null, ${nowSec}
    where exists (select 1 from "SmsMessage" where "id" = ${r.id} and "processed" = 0 and "generated_deadline_id" is null and "matched_matter_id" = ${matchedMatterId}) and ${writeGuard}
  `);
  const claim = deps.db
    .update(smsMessages)
    .set({ processed: true, processedAt: now, updatedAt: now })
    .where(and(smsClaimable, writeGuard))
    .returning({ id: smsMessages.id });
  const backRef = deps.db
    .update(smsMessages)
    .set({ generatedDeadlineId: deadlineId, updatedAt: now })
    .where(and(eq(smsMessages.id, r.id), sql`exists (select 1 from "Deadline" where "id" = ${deadlineId})`));

  const results = await deps.db.batch([deadlineInsert, claim, backRef]);
  if ((results[1] as unknown[]).length === 0) {
    throw new DomainError("INVALID_STATE", "该短信已处理、已生成期限、关联案件已变更或案件已归档，无法生成");
  }
  await deps.audit.record(auth, {
    action: "DEADLINE_CREATE",
    targetType: "Deadline",
    targetId: deadlineId,
    detail: { matterId: matchedMatterId, procedureId, category: deadlineCategory, dueAt: dueAt.toISOString() },
  });
  await deps.audit.record(auth, {
    action: "SMS_GENERATE_DEADLINE",
    targetType: "SmsMessage",
    targetId: r.id,
    detail: { matterId: r.matchedMatterId, deadlineId },
  });
  return { id: r.id, deadlineId, processed: true };
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
