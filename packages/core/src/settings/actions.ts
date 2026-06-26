/**
 * Firm-level settings (系统设置) — a small key/value store (DOMAIN-SPEC §M-settings).
 *
 * Only a minimal slice is implemented here: enough to drive seal approval
 * (firmLegalRepUserId). The full 设置 surface lands in its own increment.
 */
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { systemSettings, users } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { requireRole } from "../permissions.js";

/** Internal: read a setting's parsed value (no auth — used by other use cases). */
export async function readSetting<T = unknown>(deps: Deps, key: string): Promise<T | null> {
  const [row] = await deps.db
    .select({ valueJson: systemSettings.valueJson })
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);
  if (!row) return null;
  try {
    return JSON.parse(row.valueJson) as T;
  } catch {
    return null;
  }
}

/** The firm's legal-representative user id (gates LEGAL_REP_SEAL approval). */
export async function getFirmLegalRepUserId(deps: Deps): Promise<string | null> {
  const v = await readSetting<string>(deps, "firmLegalRepUserId");
  return typeof v === "string" && v.length > 0 ? v : null;
}

export const SetSettingInput = z.object({
  key: z.string().min(1).max(80),
  // Any JSON-serialisable value; stored as JSON text.
  value: z.unknown(),
});

/** Upsert a setting (ADMIN only). */
export async function setSetting(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN");
  const input = SetSettingInput.parse(rawInput);
  if (input.value === undefined) throw new DomainError("VALIDATION", "设置值不能为空");

  let value = input.value;
  // Known-key validation: the firm legal rep must be a STRING that either clears
  // (empty) or references a real, active user — otherwise LEGAL_REP_SEAL approval
  // would be impossible. Reject non-string values (123/null/{}/[]) which would
  // silently persist and read back as "unset".
  if (input.key === "firmLegalRepUserId") {
    if (typeof value !== "string") throw new DomainError("VALIDATION", "法定代表人必须为用户 ID 字符串");
    const id = value.trim();
    if (id.length > 0) {
      const [u] = await deps.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, id), eq(users.active, true)))
        .limit(1);
      if (!u) throw new DomainError("VALIDATION", "法定代表人必须是有效的在职用户");
    }
    value = id; // store the trimmed id (or "" to clear)
  }

  const now = deps.clock.now();
  const valueJson = JSON.stringify(value);
  // Bound the serialized size (settings are small config, not blobs) so a
  // mistaken/compromised ADMIN can't bloat the table or the settings response.
  // TextEncoder is available on both Node and Workers.
  if (new TextEncoder().encode(valueJson).length > 8192) {
    throw new DomainError("VALIDATION", "设置值过大（上限 8KB）");
  }
  await deps.db
    .insert(systemSettings)
    .values({ key: input.key, valueJson, updatedAt: now })
    .onConflictDoUpdate({ target: systemSettings.key, set: { valueJson, updatedAt: now } });
  await deps.audit.record(auth, {
    action: "SETTING_SET",
    targetType: "SystemSetting",
    targetId: input.key,
    detail: { key: input.key },
  });
  return { key: input.key };
}

/** List all settings (ADMIN only). */
export async function listSettings(deps: Deps, auth: AuthContext) {
  requireRole(auth, "ADMIN");
  const rows = await deps.db
    .select()
    .from(systemSettings)
    .orderBy(asc(systemSettings.key));
  return rows.map((r) => {
    let value: unknown = null;
    try {
      value = JSON.parse(r.valueJson);
    } catch {
      value = r.valueJson;
    }
    return { key: r.key, value, updatedAt: r.updatedAt };
  });
}
