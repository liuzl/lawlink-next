/** Preservation duration defaults by property type (DOMAIN-SPEC §6.5).
 * Legal basis: 最高法《关于办理财产保全案件若干问题的规定》第八条 —
 * 冻结银行存款等 ≤1年；查封扣押动产 ≤2年；查封不动产及其他财产权 ≤3年。
 * ⚠️ Upper limits; verify against current law. */
export type PreservationPropertyType =
  | "BANK_DEPOSIT"
  | "REAL_ESTATE"
  | "VEHICLE"
  | "EQUITY"
  | "IP"
  | "OTHER";

export const DEFAULT_DURATION_DAYS: Record<PreservationPropertyType, number> = {
  BANK_DEPOSIT: 365, // 1 年
  VEHICLE: 730, // 2 年
  OTHER: 730, // 2 年
  REAL_ESTATE: 1095, // 3 年
  EQUITY: 1095, // 3 年
  IP: 1095, // 3 年
};

export function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setDate(r.getDate() + n);
  return r;
}
