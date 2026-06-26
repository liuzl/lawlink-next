/**
 * Document folders (卷宗) — per-matter physical filing directories.
 *
 * Defaults are seeded by case category at matter creation (DOMAIN-SPEC §7.2):
 * renamable, but a default folder can't be deleted. Manual folders may be added.
 */
import { z } from "zod";
import { and, asc, eq, isNull, notExists, sql } from "drizzle-orm";
import { documentFolders, documents, matters } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps, type MatterCategory } from "../types.js";
import { requireRole } from "../permissions.js";
import { assertMatterAccess } from "../matter/access.js";
import { assertMatterWritable } from "../matter/guards.js";

/** Transaction handle (structurally a db sans `batch`) — lets folder seeding run
 * inside an outer transaction (e.g. intake conversion) or standalone. */
type Tx = Parameters<Parameters<Deps["db"]["transaction"]>[0]>[0];

/** Correlated guard: this folder's matter is NOT archived. Added to folder
 * UPDATE/DELETE predicates so an archive landing after the preflight (TOCTOU)
 * still can't mutate a closed case's folders — the guarded write matches 0
 * rows. (createFolder, an INSERT, re-checks status inside its transaction.) */
const folderMatterNotArchived = sql`exists (select 1 from ${matters} where ${matters.id} = ${documentFolders.matterId} and ${matters.status} <> 'ARCHIVED')`;

/** Default folder names by category (DOMAIN-SPEC §7.2). */
export const DEFAULT_FOLDERS: Record<MatterCategory, string[]> = {
  CIVIL_COMMERCIAL: ["收案", "立案", "委托手续", "证据", "程序文书", "庭审", "裁判", "结案"],
  ADMINISTRATIVE: ["收案", "立案", "委托手续", "证据", "程序文书", "庭审", "裁判", "结案"],
  CRIMINAL: ["收案", "委托手续", "阅卷", "会见", "取证", "庭前", "庭审", "判决与上诉", "结案"],
  NON_LITIGATION: ["立项", "调研", "工作底稿", "出具文件", "归档"],
  LEGAL_COUNSEL: ["立项", "调研", "工作底稿", "出具文件", "归档"],
  SPECIAL_PROJECT: ["立项", "调研", "工作底稿", "出具文件", "归档"],
};

/**
 * Seed the default folder set for a matter. Idempotent: skips names that already
 * exist (unique(matterId,name)), so re-running after manual edits is safe. Called
 * from convert-intake; not a standalone public use case. Returns count created.
 */
export async function seedDefaultFolders(
  deps: Deps,
  matterId: string,
  category: MatterCategory,
  tx?: Tx,
): Promise<number> {
  const db = tx ?? deps.db;
  const names = DEFAULT_FOLDERS[category] ?? DEFAULT_FOLDERS.CIVIL_COMMERCIAL;
  const now = deps.clock.now();
  const rows = names.map((name, i) => ({
    id: deps.ids.newId(),
    matterId,
    name,
    orderIndex: i,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  }));
  // onConflictDoNothing on the unique(matterId,name) index → idempotent seeding.
  await db.insert(documentFolders).values(rows).onConflictDoNothing();
  return rows.length;
}

export async function listFolders(deps: Deps, auth: AuthContext, rawInput: { matterId: string }) {
  const [m] = await deps.db
    .select({ ownerId: matters.ownerId })
    .from(matters)
    .where(eq(matters.id, rawInput.matterId))
    .limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  assertMatterAccess(m, auth); // archived matters remain viewable
  return await deps.db
    .select()
    .from(documentFolders)
    .where(eq(documentFolders.matterId, rawInput.matterId))
    .orderBy(asc(documentFolders.orderIndex), asc(documentFolders.createdAt));
}

export const CreateFolderInput = z.object({
  matterId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
});

export async function createFolder(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT");
  const input = CreateFolderInput.parse(rawInput);
  await assertMatterWritable(deps.db, auth, input.matterId);

  const now = deps.clock.now();
  const id = deps.ids.newId();
  let nextOrder = 0;
  // Re-check matter status INSIDE the txn right before the insert so an archive
  // landing after the preflight can't create a folder on a closed case.
  try {
    await deps.db.transaction(async (tx) => {
      const [m] = await tx
        .select({ status: matters.status })
        .from(matters)
        .where(eq(matters.id, input.matterId))
        .limit(1);
      if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
      if (m.status === "ARCHIVED") throw new DomainError("INVALID_STATE", "案件已归档，处于只读状态，不能新增卷宗");
      // Allocate orderIndex after the current max so manual folders sort last.
      const existing = await tx
        .select({ orderIndex: documentFolders.orderIndex })
        .from(documentFolders)
        .where(eq(documentFolders.matterId, input.matterId));
      nextOrder = existing.reduce((mx, r) => Math.max(mx, r.orderIndex), -1) + 1;
      await tx.insert(documentFolders).values({
        id,
        matterId: input.matterId,
        name: input.name,
        orderIndex: nextOrder,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      });
    });
  } catch (err) {
    if (err instanceof DomainError) throw err;
    // Unique(matterId,name) collision → a folder with this name already exists.
    throw new DomainError("CONFLICT", `卷宗「${input.name}」已存在`);
  }
  await deps.audit.record(auth, {
    action: "FOLDER_CREATE",
    targetType: "DocumentFolder",
    targetId: id,
    detail: { matterId: input.matterId },
  });
  return { id, name: input.name, orderIndex: nextOrder };
}

export const RenameFolderInput = z.object({
  folderId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
});

export async function renameFolder(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT");
  const input = RenameFolderInput.parse(rawInput);
  const [f] = await deps.db
    .select({ matterId: documentFolders.matterId })
    .from(documentFolders)
    .where(eq(documentFolders.id, input.folderId))
    .limit(1);
  if (!f) throw new DomainError("NOT_FOUND", "卷宗不存在");
  await assertMatterWritable(deps.db, auth, f.matterId); // preflight (precise errors)

  let renamed: { id: string }[];
  try {
    // Guarded on matter-not-archived (race backstop); a unique(matterId,name)
    // collision surfaces as the insert/update error and maps to CONFLICT.
    renamed = await deps.db
      .update(documentFolders)
      .set({ name: input.name, updatedAt: deps.clock.now() })
      .where(and(eq(documentFolders.id, input.folderId), folderMatterNotArchived))
      .returning({ id: documentFolders.id });
  } catch {
    throw new DomainError("CONFLICT", `卷宗「${input.name}」已存在`);
  }
  if (renamed.length === 0) throw new DomainError("INVALID_STATE", "案件已归档，处于只读状态，不能改名");
  await deps.audit.record(auth, {
    action: "FOLDER_RENAME",
    targetType: "DocumentFolder",
    targetId: input.folderId,
    detail: { matterId: f.matterId },
  });
  return { id: input.folderId, name: input.name };
}

export const DeleteFolderInput = z.object({ folderId: z.string().min(1) });

/** Delete a NON-default, EMPTY folder. Defaults are protected (§7.2); a folder
 * holding (non-deleted) documents must be emptied first. */
export async function deleteFolder(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER");
  const { folderId } = DeleteFolderInput.parse(rawInput);
  const [f] = await deps.db
    .select({ matterId: documentFolders.matterId, isDefault: documentFolders.isDefault })
    .from(documentFolders)
    .where(eq(documentFolders.id, folderId))
    .limit(1);
  if (!f) throw new DomainError("NOT_FOUND", "卷宗不存在");
  await assertMatterWritable(deps.db, auth, f.matterId);
  if (f.isDefault) throw new DomainError("INVALID_STATE", "系统预置卷宗不可删除，仅可改名");

  // Atomic empty-check + delete in ONE statement: only delete the folder when no
  // LIVE document references it, evaluated under the write lock. This closes the
  // TOCTOU where a concurrent register/move attaches a document between a
  // separate emptiness read and the delete (which would orphan that material).
  const deleted = await deps.db
    .delete(documentFolders)
    .where(
      and(
        eq(documentFolders.id, folderId),
        eq(documentFolders.isDefault, false),
        folderMatterNotArchived,
        notExists(
          deps.db
            .select({ one: sql`1` })
            .from(documents)
            .where(and(eq(documents.folderId, folderId), isNull(documents.deletedAt))),
        ),
      ),
    )
    .returning({ id: documentFolders.id });
  // 0 rows: folder became non-empty OR the matter was archived between the
  // preflight and this DELETE. Preflight already gave the precise archived
  // message for the common case; this is the race backstop.
  if (deleted.length === 0) throw new DomainError("INVALID_STATE", "卷宗内仍有材料或案件已归档，不能删除");
  await deps.audit.record(auth, {
    action: "FOLDER_DELETE",
    targetType: "DocumentFolder",
    targetId: folderId,
    detail: { matterId: f.matterId },
  });
  return { id: folderId, deleted: true };
}
