/**
 * 文书模板生成 (DocumentTemplate, DOMAIN-SPEC §5.5).
 *
 * Admin uploads a .docx template with {placeholders}; the variable set is
 * detected on upload. Generation assembles the context (firm / matter / client /
 * opposing / lead lawyer / today) from the case, renders the docx via
 * docxtemplater, stores the result as a real Document in the matter, and records
 * the template id + context snapshot for re-generation / review.
 */
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { documentTemplates, matterProcedures, matters, parties, users } from "@lawlink/db";
import {
  DomainError,
  type AuthContext,
  type Deps,
  type TemplateCategory,
} from "../types.js";
import { requireRole } from "../permissions.js";
import { assertMatterAccess } from "../matter/access.js";
import { readSetting } from "../settings/actions.js";
import { uploadDocument } from "../document/actions.js";

const TEMPLATE_CATEGORY = z.enum([
  "INTAKE", "RETAINER", "LITIGATION", "HEARING", "WORK_PRODUCT", "ARCHIVE", "CLOSING", "BLANK",
]);

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Parser that resolves dotted tags (client.name) against the nested context,
 * and returns arrays for loop sections (#parties). docxtemplater's default
 * parser does not walk dotted paths, so we supply this for rendering. */
function dottedParser(tag: string) {
  return {
    get(scope: unknown) {
      if (tag === ".") return scope;
      return tag.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), scope);
    },
  };
}

// Zip-bomb guards: a small .docx can declare/expand to huge uncompressed XML.
// We inspect the central-directory sizes (no decompression) before docxtemplater
// parses, and cap entry count, total uncompressed size, and compression ratio.
const MAX_ARCHIVE_ENTRIES = 512;
const MAX_CENTRAL_DIR_BYTES = 8 * 1024 * 1024; // central-directory region cap
const MAX_TOTAL_UNCOMPRESSED = 100 * 1024 * 1024; // 100MB expanded
const MAX_COMPRESSION_RATIO = 200; // declared-uncompressed / on-disk bytes

/** Byte-level ZIP preflight: read the End-Of-Central-Directory record straight
 * from the upload bytes and reject before `new PizZip()` ever allocates entry
 * objects. This blocks parser-level DoS from archives that pack hundreds of
 * thousands of tiny central-directory records under the 20MB upload cap — a
 * threat the post-parse uncompressed-size/ratio checks do not cover. */
function preScanZip(bytes: Uint8Array): void {
  const n = bytes.length;
  if (n < 22) throw new DomainError("VALIDATION", "不是有效的 docx 文件");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Scan backward (within the max 64KB ZIP comment window) for the EOCD sig.
  const maxBack = Math.min(n, 22 + 0xffff);
  let eocd = -1;
  for (let i = n - 22; i >= n - maxBack; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new DomainError("VALIDATION", "不是有效的 docx 文件");
  let count = dv.getUint16(eocd + 10, true);
  let cdSize = dv.getUint32(eocd + 12, true);
  // Zip64: the 16/32-bit fields are maxed out → read the true 64-bit values.
  if (count === 0xffff || cdSize === 0xffffffff) {
    const locOff = eocd - 20;
    if (locOff >= 0 && dv.getUint32(locOff, true) === 0x07064b50) {
      const z64 = Number(dv.getBigUint64(locOff + 8, true));
      if (z64 >= 0 && z64 + 56 <= n && dv.getUint32(z64, true) === 0x06064b50) {
        count = Number(dv.getBigUint64(z64 + 32, true));
        cdSize = Number(dv.getBigUint64(z64 + 40, true));
      }
    }
  }
  if (count > MAX_ARCHIVE_ENTRIES) throw new DomainError("VALIDATION", "docx 内部文件过多");
  if (cdSize > MAX_CENTRAL_DIR_BYTES) throw new DomainError("VALIDATION", "docx 目录区过大");
}

/** Reject archives whose declared expansion exceeds conservative limits. Reads
 * the per-entry uncompressedSize PizZip records from the zip headers — no entry
 * is decompressed here, so a zip bomb is caught before it can be expanded. */
function assertSafeArchive(zip: PizZip, compressedLen: number): void {
  const names = Object.keys(zip.files);
  if (names.length > MAX_ARCHIVE_ENTRIES) throw new DomainError("VALIDATION", "docx 内部文件过多");
  let total = 0;
  for (const name of names) {
    const data = (zip.files[name] as unknown as { _data?: { uncompressedSize?: number } })._data;
    total += typeof data?.uncompressedSize === "number" ? data.uncompressedSize : 0;
  }
  if (total > MAX_TOTAL_UNCOMPRESSED) throw new DomainError("VALIDATION", "docx 解压体积过大");
  if (compressedLen > 0 && total / compressedLen > MAX_COMPRESSION_RATIO) {
    throw new DomainError("VALIDATION", "docx 压缩比异常（疑似 zip bomb）");
  }
}

/** Validate the bytes are a real .docx (a zip containing word/document.xml). */
function openDocx(bytes: Uint8Array): PizZip {
  preScanZip(bytes); // byte-level EOCD guard BEFORE PizZip allocates entries
  let zip: PizZip;
  try {
    zip = new PizZip(bytes);
  } catch {
    throw new DomainError("VALIDATION", "不是有效的 docx 文件");
  }
  if (!zip.file("word/document.xml")) throw new DomainError("VALIDATION", "不是有效的 docx 文件（缺少正文）");
  assertSafeArchive(zip, bytes.length);
  return zip;
}

/** Detect the {placeholder} variable names in a docx (run-split safe via the
 * docxtemplater parser; records every tag walked during a dry render). */
function detectVariables(bytes: Uint8Array): string[] {
  const zip = openDocx(bytes);
  const tags = new Set<string>();
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    parser: (tag: string) => {
      tags.add(tag);
      return { get: () => "" };
    },
  });
  try {
    doc.render({});
  } catch {
    /* dry render only walks tags; ignore data errors */
  }
  return [...tags].filter((t) => t && !t.startsWith("#") && !t.startsWith("/") && !t.startsWith("^"));
}

// ── template CRUD ─────────────────────────────────────────────────────────────
export const CreateTemplateInput = z.object({
  name: z.string().trim().min(1).max(120),
  category: TEMPLATE_CATEGORY,
  description: z.string().max(500).optional(),
  applicableCategories: z
    .array(z.enum(["CIVIL_COMMERCIAL", "CRIMINAL", "ADMINISTRATIVE", "NON_LITIGATION", "LEGAL_COUNSEL", "SPECIAL_PROJECT"]))
    .max(6)
    .optional(),
});

export async function createTemplate(deps: Deps, auth: AuthContext, rawInput: unknown, docxBytes: Uint8Array) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER");
  const input = CreateTemplateInput.parse(rawInput);
  if (docxBytes.length === 0) throw new DomainError("VALIDATION", "模板文件为空");
  if (docxBytes.length > 20 * 1024 * 1024) throw new DomainError("VALIDATION", "模板超过 20MB 上限");
  const variables = detectVariables(docxBytes); // also validates it's a docx

  const storageKey = `tpl/${deps.ids.newId()}`;
  await deps.storage.put(storageKey, docxBytes, DOCX_MIME);
  const now = deps.clock.now();
  const id = deps.ids.newId();
  try {
    await deps.db.insert(documentTemplates).values({
      id,
      name: input.name,
      category: input.category,
      description: input.description ?? null,
      applicableCategoriesJson: JSON.stringify(input.applicableCategories ?? []),
      docxStorageKey: storageKey,
      variablesJson: JSON.stringify(variables),
      isBuiltIn: false,
      enabled: true,
      createdById: auth.userId,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    await deps.storage.delete(storageKey).catch(() => {});
    throw err;
  }
  await deps.audit.record(auth, { action: "TEMPLATE_CREATE", targetType: "DocumentTemplate", targetId: id, detail: { category: input.category, variables: variables.length } });
  return { id, name: input.name, variables };
}

export async function listTemplates(deps: Deps, _auth: AuthContext, rawInput?: { matterCategory?: string }) {
  // Any case-working role may see templates (to generate); list enabled ones,
  // optionally scoped to those applicable to a matter's category.
  const rows = await deps.db
    .select()
    .from(documentTemplates)
    .where(eq(documentTemplates.enabled, true))
    .orderBy(asc(documentTemplates.category), asc(documentTemplates.name));
  const mapped = rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    description: r.description,
    applicableCategories: JSON.parse(r.applicableCategoriesJson) as string[],
    variables: JSON.parse(r.variablesJson) as string[],
    isBuiltIn: r.isBuiltIn,
  }));
  const cat = rawInput?.matterCategory;
  if (!cat) return mapped;
  // Empty applicableCategories = applies to all.
  return mapped.filter((t) => t.applicableCategories.length === 0 || t.applicableCategories.includes(cat));
}

export const DeleteTemplateInput = z.object({ templateId: z.string().min(1) });
export async function deleteTemplate(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER");
  const { templateId } = DeleteTemplateInput.parse(rawInput);
  const [t] = await deps.db.select({ isBuiltIn: documentTemplates.isBuiltIn, docxStorageKey: documentTemplates.docxStorageKey }).from(documentTemplates).where(eq(documentTemplates.id, templateId)).limit(1);
  if (!t) throw new DomainError("NOT_FOUND", "模板不存在");
  if (t.isBuiltIn) throw new DomainError("INVALID_STATE", "系统内置模板不可删除");
  await deps.db.delete(documentTemplates).where(eq(documentTemplates.id, templateId));
  await deps.storage.delete(t.docxStorageKey).catch(() => {});
  await deps.audit.record(auth, { action: "TEMPLATE_DELETE", targetType: "DocumentTemplate", targetId: templateId, detail: {} });
  return { id: templateId, deleted: true };
}

// ── context assembly ──────────────────────────────────────────────────────────
/** Build the variable context for a matter (firm / matter / client / opposing /
 * lead / today / parties). assertMatterAccess is the caller's job. */
async function assembleContext(deps: Deps, matterId: string) {
  const [m] = await deps.db.select().from(matters).where(eq(matters.id, matterId)).limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  const partyRows = await deps.db.select({ role: parties.role, name: parties.name, idNumber: parties.idNumber }).from(parties).where(eq(parties.matterId, matterId));
  const client = partyRows.find((p) => p.role === "CLIENT_PARTY");
  const opposing = partyRows.find((p) => p.role === "OPPOSING_PARTY");
  const [proc] = await deps.db.select({ caseNumber: matterProcedures.caseNumber }).from(matterProcedures).where(and(eq(matterProcedures.matterId, matterId), eq(matterProcedures.engagement, "ENGAGED"))).limit(1);
  const [owner] = await deps.db.select({ name: users.name }).from(users).where(eq(users.id, m.ownerId)).limit(1);
  const firmName = (await readSetting<string>(deps, "firmName")) ?? "";
  const firmAddress = (await readSetting<string>(deps, "firmAddress")) ?? "";
  const now = deps.clock.now();
  const today = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

  return {
    firm: { name: firmName, address: firmAddress },
    matter: { internalCode: m.internalCode, title: m.title, category: m.category, caseNumber: proc?.caseNumber ?? "" },
    client: { name: client?.name ?? m.primaryClientName ?? "", idNumber: client?.idNumber ?? "" },
    opposing: { name: opposing?.name ?? "", idNumber: opposing?.idNumber ?? "" },
    lead: { name: owner?.name ?? "" },
    today,
    parties: partyRows.map((p) => ({ role: p.role, name: p.name, idNumber: p.idNumber ?? "" })),
  } as Record<string, unknown>;
}

/** A flat lookup of dotted variable → resolved value (for missing-var reporting). */
function flatten(ctx: Record<string, unknown>, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(ctx)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [kk, vv] of flatten(v as Record<string, unknown>, key)) out.set(kk, vv);
    } else {
      out.set(key, v);
    }
  }
  return out;
}

export const PreviewTemplateInput = z.object({ templateId: z.string().min(1), matterId: z.string().min(1) });

/** Report the template's variables and which are unresolved for this matter, so
 * the UI can prompt the user to fill them before generating. */
export async function previewTemplate(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT");
  const input = PreviewTemplateInput.parse(rawInput);
  const [t] = await deps.db.select().from(documentTemplates).where(eq(documentTemplates.id, input.templateId)).limit(1);
  if (!t || !t.enabled) throw new DomainError("NOT_FOUND", "模板不存在");
  const [m] = await deps.db.select({ ownerId: matters.ownerId, category: matters.category }).from(matters).where(eq(matters.id, input.matterId)).limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  assertMatterAccess(m, auth);
  // Same applicability gate as generateFromTemplate — preview must not leak a
  // template's variables/metadata for a matter category it can't be used on.
  const applicable = JSON.parse(t.applicableCategoriesJson) as string[];
  if (applicable.length && !applicable.includes(m.category)) {
    throw new DomainError("VALIDATION", "该模板不适用于本案件类别");
  }
  const ctx = await assembleContext(deps, input.matterId);
  const flat = flatten(ctx);
  const variables = JSON.parse(t.variablesJson) as string[];
  const scalar = variables.filter((v) => !v.includes("[")); // skip loop sections
  const missing = scalar.filter((v) => {
    const val = flat.get(v);
    return val === undefined || val === null || val === "";
  });
  return { templateName: t.name, variables, missing };
}

export const GenerateTemplateInput = z.object({
  templateId: z.string().min(1),
  matterId: z.string().min(1),
  folderId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  // Inline fills for missing/overridden variables (dotted key → value).
  overrides: z.record(z.string(), z.string()).optional(),
});

export async function generateFromTemplate(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT");
  const input = GenerateTemplateInput.parse(rawInput);
  const [t] = await deps.db.select().from(documentTemplates).where(eq(documentTemplates.id, input.templateId)).limit(1);
  if (!t || !t.enabled) throw new DomainError("NOT_FOUND", "模板不存在");
  const [m] = await deps.db.select({ ownerId: matters.ownerId, category: matters.category }).from(matters).where(eq(matters.id, input.matterId)).limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  assertMatterAccess(m, auth);
  const applicable = JSON.parse(t.applicableCategoriesJson) as string[];
  if (applicable.length && !applicable.includes(m.category)) {
    throw new DomainError("VALIDATION", "该模板不适用于本案件类别");
  }

  // Context + inline overrides (dotted keys set nested paths). Override keys are
  // user-controlled, so reject prototype-pollution segments before walking them
  // into the (shared-runtime) context object.
  const ctx = await assembleContext(deps, input.matterId);
  if (input.overrides) {
    for (const [dotted, value] of Object.entries(input.overrides)) {
      const segs = dotted.split(".");
      if (segs.some((s) => s === "__proto__" || s === "prototype" || s === "constructor" || s.length === 0)) {
        throw new DomainError("VALIDATION", "非法的变量名");
      }
      let cur = ctx as Record<string, unknown>;
      for (let i = 0; i < segs.length - 1; i++) {
        const next = cur[segs[i]];
        if (typeof next !== "object" || next === null || Array.isArray(next)) cur[segs[i]] = {};
        cur = cur[segs[i]] as Record<string, unknown>;
      }
      cur[segs[segs.length - 1]] = value;
    }
  }

  // Render the docx (missing tags render empty; we report them via previewTemplate).
  const templateBytes = await deps.storage.get(t.docxStorageKey);
  const doc = new Docxtemplater(openDocx(templateBytes), { paragraphLoop: true, linebreaks: true, nullGetter: () => "", parser: dottedParser });
  let rendered: Uint8Array;
  try {
    doc.render(ctx);
    rendered = doc.getZip().generate({ type: "uint8array" });
  } catch (err) {
    throw new DomainError("VALIDATION", `模板渲染失败：${err instanceof Error ? err.message : String(err)}`);
  }

  // Store as a real Document with its template provenance set atomically in the
  // same insert (no separate UPDATE that could fail and leave an unstamped doc).
  const res = await uploadDocument(
    deps,
    auth,
    { matterId: input.matterId, name: input.name ?? `${t.name}.docx`, category: "OTHER", folderId: input.folderId, mimeType: DOCX_MIME },
    rendered,
    { templateId: t.id, templateContextJson: JSON.stringify(ctx) },
  );
  await deps.audit.record(auth, { action: "TEMPLATE_GENERATE", targetType: "Document", targetId: res.id, detail: { templateId: t.id, matterId: input.matterId } });
  return { documentId: res.id, name: input.name ?? `${t.name}.docx` };
}

export type { TemplateCategory };
