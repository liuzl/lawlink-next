/**
 * Legal-deadline computation engine (DOMAIN-SPEC §9.1).
 *
 * Given an event (judgment served, complaint served, …), its date, and the
 * matter category, returns the statutory deadlines that flow from it. This is
 * the core "主动防错" value: the system computes 上诉期/答辩期/执行时效 instead
 * of relying on the lawyer to remember them.
 *
 * ⚠️ Periods count from the day AFTER the event (期间开始之日不计). 末日为法定
 * 节假日顺延 is NOT modeled here (no holiday calendar) — each result's `basis`
 * notes this so a lawyer can adjust. Verify against current law before relying.
 */
import type { MatterCategory } from "../types.js";

export type DeadlineEvent =
  | "JUDGMENT_SERVED" // 判决书送达
  | "RULING_SERVED" // 裁定书送达
  | "COMPLAINT_SERVED" // 起诉状副本送达
  | "JUDGMENT_EFFECTIVE" // 裁判生效
  | "PERFORMANCE_DUE" // 履行期限届满
  | "ARBITRATION_AWARD_RECEIVED"; // 收到仲裁裁决书

export type DeadlineCategory =
  | "APPEAL"
  | "RESPONSE"
  | "ENFORCEMENT"
  | "RETRIAL_APPLICATION"
  | "ARBITRATION_SET_ASIDE"
  | "LIMITATION"
  | "CUSTOM";

export interface ComputedDeadline {
  category: DeadlineCategory;
  title: string;
  dueAt: Date;
  basis: string;
}

const HOLIDAY_NOTE = "（末日逢法定节假日顺延，需人工核对）";

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setDate(r.getDate() + n);
  return r;
}
function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setMonth(r.getMonth() + n);
  return r;
}
function addYears(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setFullYear(r.getFullYear() + n);
  return r;
}

/** Compute the statutory deadlines flowing from an event. */
export function computeDeadlines(
  category: MatterCategory,
  event: DeadlineEvent,
  eventDate: Date,
): ComputedDeadline[] {
  const isCriminal = category === "CRIMINAL";
  const out: ComputedDeadline[] = [];

  switch (event) {
    case "JUDGMENT_SERVED": {
      const days = isCriminal ? 10 : 15;
      out.push({
        category: "APPEAL",
        title: `上诉期限（${days}日）`,
        dueAt: addDays(eventDate, days),
        basis: `${isCriminal ? "刑诉法" : "民诉法/行诉法"}：不服判决的上诉期 ${days} 日，自判决书送达次日起算${HOLIDAY_NOTE}`,
      });
      break;
    }
    case "RULING_SERVED": {
      const days = 10;
      out.push({
        category: "APPEAL",
        title: `上诉期限（裁定，${days}日）`,
        dueAt: addDays(eventDate, days),
        basis: `不服裁定的上诉期 ${days} 日，自裁定书送达次日起算${HOLIDAY_NOTE}`,
      });
      break;
    }
    case "COMPLAINT_SERVED": {
      out.push({
        category: "RESPONSE",
        title: "答辩期限（15日）",
        dueAt: addDays(eventDate, 15),
        basis: `被告答辩期 15 日，自收到起诉状副本次日起算（涉外当事人 30 日，需人工调整）${HOLIDAY_NOTE}`,
      });
      break;
    }
    case "JUDGMENT_EFFECTIVE": {
      out.push({
        category: "ENFORCEMENT",
        title: "申请强制执行时效（2年）",
        dueAt: addYears(eventDate, 2),
        basis: "申请执行时效 2 年，自法律文书规定履行期间最后一日起；本项以裁判生效日近似，需按履行期核对",
      });
      out.push({
        category: "RETRIAL_APPLICATION",
        title: "申请再审期限（6个月）",
        dueAt: addMonths(eventDate, 6),
        basis: "当事人申请再审 6 个月，自裁判发生法律效力后起（特定情形自知道或应当知道之日起）",
      });
      break;
    }
    case "PERFORMANCE_DUE": {
      out.push({
        category: "ENFORCEMENT",
        title: "申请强制执行时效（2年）",
        dueAt: addYears(eventDate, 2),
        basis: "申请执行时效 2 年，自法律文书规定的履行期间最后一日起；分期履行的自每次履行期间最后一日起",
      });
      break;
    }
    case "ARBITRATION_AWARD_RECEIVED": {
      out.push({
        category: "ARBITRATION_SET_ASIDE",
        title: "申请撤销仲裁裁决期限（6个月）",
        dueAt: addMonths(eventDate, 6),
        basis: "申请撤销仲裁裁决 6 个月，自收到裁决书之日起",
      });
      break;
    }
  }

  return out;
}
