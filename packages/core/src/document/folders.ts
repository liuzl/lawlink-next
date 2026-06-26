/**
 * Document folders (卷宗) — per-matter physical filing directories.
 *
 * Defaults are seeded by case category at matter creation (DOMAIN-SPEC §7.2):
 * renamable, but a default folder can't be deleted. Manual folders may be added.
 */
import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { documentFolders, documents, matters } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps, type MatterCategory } from "../types.js";
import { requireRole } from "../permissions.js";
import { assertMatterAccess } from "../matter/access.js";
import { assertMatterWritable } from "../matter/guards.js";

/** Transaction handle (structurally a db sans `batch`) — lets folder seeding run
 * inside an outer transaction (e.g. intake conversion) or standalone. */
type Tx = Parameters<Parameters<Deps["db"]["transaction"]>[0]>[0];

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

  // Allocate orderIndex after the current max so manual folders sort last.
  const existing = await deps.db
    .select({ orderIndex: documentFolders.orderIndex })
    .from(documentFolders)
    .where(eq(documentFolders.matterId, input.matterId));
  const nextOrder = existing.reduce((m, r) => Math.max(m, r.orderIndex), -1) + 1;

  const now = deps.clock.now();
  const id = deps.ids.newId();
  try {
    await deps.db.insert(documentFolders).values({
      id,
      matterId: input.matterId,
      name: input.name,
      orderIndex: nextOrder,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
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
  await assertMatterWritable(deps.db, auth, f.matterId);

  try {
    await deps.db
      .update(documentFolders)
      .set({ name: input.name, updatedAt: deps.clock.now() })
      .where(eq(documentFolders.id, input.folderId));
  } catch {
    throw new DomainError("CONFLICT", `卷宗「${input.name}」已存在`);
  }
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

  const [held] = await deps.db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.folderId, folderId), isNull(documents.deletedAt)))
    .limit(1);
  if (held) throw new DomainError("INVALID_STATE", "卷宗内仍有材料，请先移出或删除");

  await deps.db.delete(documentFolders).where(eq(documentFolders.id, folderId));
  await deps.audit.record(auth, {
    action: "FOLDER_DELETE",
    targetType: "DocumentFolder",
    targetId: folderId,
    detail: { matterId: f.matterId },
  });
  return { id: folderId, deleted: true };
}
