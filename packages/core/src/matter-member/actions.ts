/**
 * Matter team membership (承办团队) — DOMAIN-SPEC §2.2.
 *
 * The roster (MatterMember) holds the LEAD (主办), CO_LEAD (协办律师) and
 * ASSISTANT (助理) for a matter. The owner (matters.ownerId) is mirrored here as
 * the LEAD member, so a single roster drives both access (../matter/access) and
 * team display. Membership is what lets a non-owner lawyer/assistant open a
 * matter and be assigned its tasks.
 *
 * The team is replaced atomically (one mutation rebuilds the whole roster +
 * syncs matters.ownerId), which keeps owner and roster consistent and avoids
 * partial-update races. Only the current owner or management may edit the team.
 */
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { matterMembers, matters, users } from "@lawlink/db";
import {
  DomainError,
  type AuthContext,
  type Deps,
  type MatterMemberRole,
  type Role,
} from "../types.js";
import { isManagement } from "../permissions.js";
import { assertMatterAccess } from "../matter/access.js";

const ROLE_ORDER: Record<MatterMemberRole, number> = { LEAD: 0, CO_LEAD: 1, ASSISTANT: 2 };

/** Roles allowed to hold a LEAD / CO_LEAD seat (must be a practising lawyer). */
const LAWYER_ROLES: ReadonlySet<Role> = new Set(["ADMIN", "PRINCIPAL_LAWYER", "LAWYER"]);

/** List a matter's team, joined with each member's name + firm role. Any caller
 * who can access the matter may view its roster. */
export async function listMatterMembers(deps: Deps, auth: AuthContext, rawInput: { matterId: string }) {
  const [m] = await deps.db
    .select({ id: matters.id, ownerId: matters.ownerId })
    .from(matters)
    .where(eq(matters.id, rawInput.matterId))
    .limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  await assertMatterAccess(deps.db, m, auth);

  const rows = await deps.db
    .select({
      userId: matterMembers.userId,
      role: matterMembers.role,
      joinedAt: matterMembers.joinedAt,
      name: users.name,
      userRole: users.role,
      active: users.active,
    })
    .from(matterMembers)
    .innerJoin(users, eq(users.id, matterMembers.userId))
    .where(eq(matterMembers.matterId, rawInput.matterId));

  return rows
    .map((r) => ({ ...r, role: r.role as MatterMemberRole }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
}

export const SetMatterTeamInput = z.object({
  matterId: z.string().min(1),
  ownerId: z.string().min(1),
  coLeadIds: z.array(z.string().min(1)).max(20).default([]),
  assistantIds: z.array(z.string().min(1)).max(20).default([]),
});

/** Replace a matter's whole team and sync matters.ownerId. Only the current
 * owner or management may do this. The owner becomes LEAD; co-counsel CO_LEAD;
 * assistants ASSISTANT. Dedup precedence: owner > co-lead > assistant. */
export async function setMatterTeam(deps: Deps, auth: AuthContext, rawInput: unknown) {
  const input = SetMatterTeamInput.parse(rawInput);

  const [m] = await deps.db
    .select({ id: matters.id, ownerId: matters.ownerId, status: matters.status })
    .from(matters)
    .where(eq(matters.id, input.matterId))
    .limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  // Authorization: the current 主办 or management. (Returning NOT_FOUND for a
  // non-owner case-worker keeps matter existence unprobeable.)
  if (!isManagement(auth) && m.ownerId !== auth.userId) {
    throw new DomainError("NOT_FOUND", "案件不存在");
  }
  if (m.status === "ARCHIVED") throw new DomainError("INVALID_STATE", "案件已归档，处于只读状态，不能调整团队");

  // Dedup with owner > co-lead > assistant precedence.
  const coLeadIds = [...new Set(input.coLeadIds)].filter((id) => id !== input.ownerId);
  const coLeadSet = new Set(coLeadIds);
  const assistantIds = [...new Set(input.assistantIds)].filter((id) => id !== input.ownerId && !coLeadSet.has(id));

  // Validate every referenced user exists, is active, and may hold its seat.
  const allIds = [input.ownerId, ...coLeadIds, ...assistantIds];
  const userRows = await deps.db
    .select({ id: users.id, role: users.role, active: users.active })
    .from(users)
    .where(inArray(users.id, allIds));
  const byId = new Map(userRows.map((u) => [u.id, u]));
  for (const id of allIds) {
    const u = byId.get(id);
    if (!u || !u.active) throw new DomainError("VALIDATION", "成员用户无效");
  }
  // Owner + co-counsel must be practising lawyers; nobody on the team may be FINANCE.
  const owner = byId.get(input.ownerId)!;
  if (!LAWYER_ROLES.has(owner.role as Role)) throw new DomainError("VALIDATION", "主办律师必须是律师角色");
  for (const id of coLeadIds) {
    if (!LAWYER_ROLES.has(byId.get(id)!.role as Role)) throw new DomainError("VALIDATION", "协办律师必须是律师角色");
  }
  for (const id of assistantIds) {
    if ((byId.get(id)!.role as Role) === "FINANCE") throw new DomainError("VALIDATION", "财务不能加入承办团队");
  }

  const now = deps.clock.now();
  const joinedSec = Math.floor(now.getTime() / 1000);
  // Replace the whole roster + sync ownerId ATOMICALLY in one batch() (a single
  // transaction on libSQL AND D1 — D1 has no interactive transactions). Every
  // write is guarded by `guard` = the matter exists, is NOT archived, and the
  // caller is STILL its owner (or management) — re-checked at WRITE time, not
  // trusted from the prechecks above (which only give early friendly errors). So
  // if ownership changes or the matter is archived between precheck and commit,
  // all three writes no-op together (never a partial roster) and the claim
  // (statement 0) returns 0 rows → we reject. The claim also yields prevOwnerId
  // for the audit. Within one transaction the claim and the guarded writes see
  // the same snapshot, so they pass or fail together. joined_at is epoch seconds.
  const ownerCond = isManagement(auth) ? sql`1=1` : sql`m."owner_id" = ${auth.userId}`;
  const guard = sql`exists (select 1 from "Matter" m where m."id" = ${input.matterId} and m."status" <> 'ARCHIVED' and (${ownerCond}))`;

  const claim = deps.db
    .select({ ownerId: matters.ownerId })
    .from(matters)
    .where(
      and(
        eq(matters.id, input.matterId),
        sql`${matters.status} <> 'ARCHIVED'`,
        isManagement(auth) ? sql`1=1` : eq(matters.ownerId, auth.userId),
      ),
    );
  const del = deps.db.delete(matterMembers).where(and(eq(matterMembers.matterId, input.matterId), guard));
  const memberValues = [
    sql`(${deps.ids.newId()}, ${input.matterId}, ${input.ownerId}, 'LEAD', ${joinedSec})`,
    ...coLeadIds.map((uid) => sql`(${deps.ids.newId()}, ${input.matterId}, ${uid}, 'CO_LEAD', ${joinedSec})`),
    ...assistantIds.map((uid) => sql`(${deps.ids.newId()}, ${input.matterId}, ${uid}, 'ASSISTANT', ${joinedSec})`),
  ];
  const ins = deps.db
    .insert(matterMembers)
    .select(sql`select * from (values ${sql.join(memberValues, sql`, `)}) where ${guard}`);
  const upd = deps.db.update(matters).set({ ownerId: input.ownerId }).where(and(eq(matters.id, input.matterId), guard));

  const results = await deps.db.batch([claim, del, ins, upd]);
  const claimRows = results[0] as { ownerId: string }[];
  if (claimRows.length === 0) {
    throw new DomainError("INVALID_STATE", "案件已归档或您已不是主办，无法调整团队");
  }
  const prevOwnerId = claimRows[0].ownerId;

  await deps.audit.record(auth, {
    action: "MATTER_TEAM_SET",
    targetType: "Matter",
    targetId: input.matterId,
    detail: {
      ownerChanged: prevOwnerId !== input.ownerId,
      coLeads: coLeadIds.length,
      assistants: assistantIds.length,
    },
  });
  return {
    matterId: input.matterId,
    ownerId: input.ownerId,
    coLeadIds,
    assistantIds,
  };
}
