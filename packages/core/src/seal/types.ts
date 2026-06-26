/**
 * Seal-type catalog + approver resolution (用印审批, DOMAIN-SPEC §5.3).
 *
 * The mapping lives in code (the source of truth for who may approve each seal).
 * A future increment can layer an admin-editable SealTypeConfig table over this.
 */
import type { Role, SealType } from "../types.js";

export interface SealTypeDef {
  label: string;
  /** Roles that may approve this seal (OR). ADMIN may approve any seal. */
  approverRoles: Role[];
  /** If true, only the firm's legal representative (settings) may approve. */
  requiresLegalRep: boolean;
}

/** Approver mapping per DOMAIN-SPEC §5.3:
 *  - 公章 / 合同章 / 合同审核章 → 主任 (PRINCIPAL_LAWYER)
 *  - 财务章 → 财务 (FINANCE)
 *  - 法定代表人章 → 设置里指定的法定代表人本人
 *  - ADMIN 跨章可审 (handled in the resolver, not listed per type). */
export const SEAL_TYPES: Record<SealType, SealTypeDef> = {
  OFFICIAL_SEAL: { label: "公章", approverRoles: ["PRINCIPAL_LAWYER"], requiresLegalRep: false },
  CONTRACT_SEAL: { label: "合同专用章", approverRoles: ["PRINCIPAL_LAWYER"], requiresLegalRep: false },
  CONTRACT_REVIEW_SEAL: { label: "合同审核章", approverRoles: ["PRINCIPAL_LAWYER"], requiresLegalRep: false },
  FINANCE_SEAL: { label: "财务专用章", approverRoles: ["FINANCE"], requiresLegalRep: false },
  LEGAL_REP_SEAL: { label: "法定代表人章", approverRoles: [], requiresLegalRep: true },
};

export function isSealType(v: string): v is SealType {
  return v in SEAL_TYPES;
}

/** The set of seal types a given role can appear in the approver queue for
 * (used to scope the approval list). ADMIN sees all. */
export function approvableSealTypes(role: Role): SealType[] {
  if (role === "ADMIN") return Object.keys(SEAL_TYPES) as SealType[];
  return (Object.keys(SEAL_TYPES) as SealType[]).filter(
    (t) => SEAL_TYPES[t].approverRoles.includes(role) || SEAL_TYPES[t].requiresLegalRep,
  );
}
