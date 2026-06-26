/** Internal case-number format (DOMAIN-SPEC §6.1): LL-{YYYY}-{CODE}-{NNNN}. */
import type { MatterCategory } from "../types.js";

export const INTERNAL_CODE_PREFIX: Record<MatterCategory, string> = {
  CIVIL_COMMERCIAL: "CC",
  CRIMINAL: "CR",
  ADMINISTRATIVE: "AD",
  NON_LITIGATION: "NL",
  LEGAL_COUNSEL: "GC",
  SPECIAL_PROJECT: "SP",
};

export function counterKey(year: number, prefix: string): string {
  return `code-${year}-${prefix}`;
}

export function formatInternalCode(year: number, prefix: string, seq: number): string {
  return `LL-${year}-${prefix}-${String(seq).padStart(4, "0")}`;
}
