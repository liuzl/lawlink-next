---
name: lawlink-invoice
version: 0.1.0
description: "开票工作流 —— 申请(开票依据必传)→审批→开具(回填发票号+电子发票)。"
metadata:
  requires:
    bins: ["lawlink"]
  cliHelp: "lawlink invoice --help"
---

# Skill: 开票 (Invoice)

> 种子：DOMAIN-SPEC §5.4。状态：`PENDING → APPROVED → ISSUED`；旁支 `REJECTED`。

## 关键规则
- 申请人：案件 LEAD/CO_LEAD/ADMIN。审批/开具：FINANCE/ADMIN/PRINCIPAL_LAWYER。
- **开票依据附件必传** `--evidence-doc-id`（Document id，可多个）。
- 无关联案件时必须给 `--matterless-reason`。
- 开具(ISSUED)须回填发票号 `--invoice-no` + 电子发票 `--invoice-file-id`（Document id）。

## 命令
```bash
lawlink invoice create --amount 100000.00 --evidence-doc-id <docId> [--evidence-doc-id <docId2>] \
  --matter-id <id> --invoice-type SPECIAL --buyer-name "客户公司" --buyer-tax-no … --token "$T"
lawlink invoice list --status PENDING --token "$T"
lawlink invoice show --id <invId> --token "$T"
lawlink invoice approve --id <invId> --note "同意" --token "$T"
lawlink invoice reject  --id <invId> --note "抬头有误" --token "$T"
lawlink invoice issue   --id <invId> --invoice-no "0123456" --invoice-file-id <docId> --token "$T"
```
