---
name: lawlink-seal
version: 0.1.0
description: "用印审批 —— 用章申请→按章种类审批→盖章登记(必传扫描件)。"
metadata:
  requires:
    bins: ["lawlink"]
  cliHelp: "lawlink seal --help"
---

# Skill: 用印审批 (Seal)

> 种子：DOMAIN-SPEC §5.3。状态：`PENDING → APPROVED → STAMPED`；旁支 `REJECTED`/`CANCELLED`。

## 关键规则
- 申请必须带**待盖章稿** `--draft-doc-id`（一个 Document id；用印必关联案件）。
- **审批人按章种类映射**：公章/合同章/审核章→主任(PRINCIPAL_LAWYER)；财务章→财务；法定代表人章→Settings 指定的法定代表人本人；ADMIN 跨章可审。无权审 → `FORBIDDEN`(exit 3)。
- **前置门**：进 `STAMPED` 必须提供盖章后扫描件 `--stamped-doc-id`（合规留痕，事后无法补——硬卡）。
- 撤销仅在审批前（→ CANCELLED）；被驳回(REJECTED)可引用旧 id 重新提交。

## 命令
```bash
lawlink seal types --token "$T"        # 章种类目录 + 各自审批人
lawlink seal create --seal-type CONTRACT_SEAL --purpose "签约" --document-title "服务合同" \
  --draft-doc-id <docId> --matter-id <id> --urgency NORMAL --token "$T"
#   --seal-type: OFFICIAL_SEAL|CONTRACT_SEAL|CONTRACT_REVIEW_SEAL|FINANCE_SEAL|LEGAL_REP_SEAL
lawlink seal list --status PENDING --token "$T"
lawlink seal show --id <sealId> --token "$T"
lawlink seal approve --id <sealId> --note "同意" --token "$T"
lawlink seal reject  --id <sealId> --note "材料不全" --token "$T"
lawlink seal stamp   --id <sealId> --stamped-doc-id <scanDocId> --token "$T"   # APPROVED → STAMPED
lawlink seal cancel  --id <sealId> --token "$T"
```
- 申请编号 `SEAL-{年}-{NNNN}` 自动生成（无 gap）。同一待盖章稿被占用 → `CONFLICT`(exit 5)。
