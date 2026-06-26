/** Closing completeness checklists by category (DOMAIN-SPEC §6.6). */
import type { MatterCategory } from "../types.js";

const LITIGATION = [
  "委托代理合同",
  "授权委托书",
  "起诉状/答辩状/上诉状",
  "证据目录及证据材料",
  "裁判文书",
  "结案登记表",
  "办案小结",
  "卷宗封皮",
  "卷宗目录",
];
const NON_LITIGATION = [
  "委托代理合同",
  "法律意见书",
  "出具法律文件",
  "结案登记表",
  "办案小结",
  "卷宗封皮",
  "卷宗目录",
];
const LEGAL_COUNSEL = [
  "法律顾问合同",
  "出具法律意见汇总",
  "期满总结/续约/终止说明",
  "卷宗封皮",
  "卷宗目录",
];

export function requiredChecklist(category: MatterCategory): string[] {
  switch (category) {
    case "CIVIL_COMMERCIAL":
    case "CRIMINAL":
    case "ADMINISTRATIVE":
      return LITIGATION;
    case "LEGAL_COUNSEL":
      return LEGAL_COUNSEL;
    default:
      return NON_LITIGATION;
  }
}
