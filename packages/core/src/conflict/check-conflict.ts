/**
 * Use case: conflict check (利益冲突检索) — DOMAIN-SPEC §6.2.
 *
 * Severity is decided by (candidate role × matched-history role), with an
 * exact ID-number match bumping one level. Searches the firm-wide Party corpus
 * (parties of any intake or matter). Exact name / idNumber matching for now;
 * fuzzy + alias recall is a documented enhancement (DOMAIN-SPEC §9.3).
 */
import { z } from "zod";
import { eq, or } from "drizzle-orm";
import { conflictChecks, intakes, parties } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";

export type PartyRole = "CLIENT_PARTY" | "OPPOSING_PARTY" | "THIRD_PARTY";
export type Severity = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "BLOCKING";

const ORDER: Severity[] = ["NONE", "LOW", "MEDIUM", "HIGH", "BLOCKING"];

/** Base severity for a (candidate, history) role pair (before ID bump). */
function baseSeverity(candidate: PartyRole, history: PartyRole): Severity {
  if (candidate === "THIRD_PARTY" || history === "THIRD_PARTY") return "MEDIUM";
  // we previously represented them, now they're the opponent → hard conflict
  if (candidate === "OPPOSING_PARTY" && history === "CLIENT_PARTY") return "BLOCKING";
  // former opponent now wants to be our client
  if (candidate === "CLIENT_PARTY" && history === "OPPOSING_PARTY") return "HIGH";
  // opp×opp (past litigation) or client×client (repeat client)
  return "LOW";
}

function bump(sev: Severity): Severity {
  if (sev === "NONE" || sev === "BLOCKING") return sev;
  return ORDER[Math.min(ORDER.indexOf(sev) + 1, ORDER.length - 1)];
}

function maxSeverity(a: Severity, b: Severity): Severity {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

export const ConflictQueryInput = z
  .object({
    name: z.string().min(1).max(200).optional(),
    idNumber: z.string().min(1).max(64).optional(),
    candidateRole: z
      .enum(["CLIENT_PARTY", "OPPOSING_PARTY", "THIRD_PARTY"])
      .default("OPPOSING_PARTY"),
    /** Optional link to the intake this check is for (audit trail). */
    intakeId: z.string().min(1).optional(),
  })
  .refine((v) => v.name || v.idNumber, "需至少提供 name 或 idNumber");

export interface ConflictHit {
  partyId: string;
  name: string;
  historyRole: PartyRole;
  matchedField: "name" | "idNumber";
  severity: Severity;
  matterId: string | null;
  intakeId: string | null;
}

export interface ConflictResult {
  topSeverity: Severity;
  hitCount: number;
  hits: ConflictHit[];
}

export async function runConflictCheck(
  deps: Deps,
  auth: AuthContext,
  rawInput: unknown,
): Promise<ConflictResult> {
  const input = ConflictQueryInput.parse(rawInput);
  const candidate = input.candidateRole as PartyRole;

  // The audit link must reference a real intake, or it cannot be trusted by an
  // approver. Validate existence before persisting a caller-supplied intakeId.
  if (input.intakeId) {
    const [intake] = await deps.db
      .select({ id: intakes.id })
      .from(intakes)
      .where(eq(intakes.id, input.intakeId))
      .limit(1);
    if (!intake) throw new DomainError("NOT_FOUND", "关联收案不存在");
  }

  const predicates = [];
  if (input.name) predicates.push(eq(parties.name, input.name));
  if (input.idNumber) predicates.push(eq(parties.idNumber, input.idNumber));

  const matched = await deps.db
    .select()
    .from(parties)
    .where(or(...predicates));

  let top: Severity = "NONE";
  const hits: ConflictHit[] = matched.map((p) => {
    const idMatch = !!input.idNumber && p.idNumber === input.idNumber;
    const history = p.role as PartyRole;
    const severity = idMatch
      ? bump(baseSeverity(candidate, history))
      : baseSeverity(candidate, history);
    top = maxSeverity(top, severity);
    return {
      partyId: p.id,
      name: p.name,
      historyRole: history,
      matchedField: idMatch ? "idNumber" : "name",
      severity,
      matterId: p.matterId,
      intakeId: p.intakeId,
    };
  });

  await deps.db.insert(conflictChecks).values({
    id: deps.ids.newId(),
    intakeId: input.intakeId ?? null,
    queryName: input.name ?? null,
    queryIdNumber: input.idNumber ?? null,
    candidateRole: candidate,
    topSeverity: top,
    hitCount: hits.length,
    checkedById: auth.userId,
    createdAt: deps.clock.now(),
  });

  return { topSeverity: top, hitCount: hits.length, hits };
}
