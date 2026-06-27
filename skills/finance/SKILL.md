---
name: lawlink-finance
version: 0.1.0
description: "财务 —— 分成方案、记账（实收自动生成分成）、删除流水（级联分成）、台账。"
metadata:
  requires:
    bins: ["lawlink"]
  cliHelp: "lawlink finance --help"
---

# Skill: 财务 (Finance)

> 种子：DOMAIN-SPEC §6.3、§2.2。金额一律定点小数字符串（最多两位），**不要用浮点**。

## 概念消歧 / 权限
- **谁能记账**：管理角色 + FINANCE（全所财务）+ 该案**主办律师**。非主办律师不能动他人案件财务。
- **分成方案 set-plan 更严**：仅**主办或管理角色**（不含 FINANCE、不含协办/助理）——决定"谁拿钱"。
- 财务写操作**允许在已归档案件上**（结案后还有尾款），与正文只读不同。

## 关键规则（自动分成）
- 每条 **RECEIVED（实收）** 入账时，按 active 分成方案**自动生成 COMMISSION 子条目**（`-X×percent/100`，挂受益人、链回父条目）。采用累计取整，子项之和精确。
- **删除 RECEIVED → 级联删除其 COMMISSION 子条目**（原子）。系统生成的 COMMISSION **不能单独删**。
- 百分比 0–100；之和不强制 = 100（律所留存隐含）。

## 命令
```bash
# 设分成方案：--plan userId:percent[:label] 可多次（整体替换）
lawlink finance set-plan --matter-id <id> --plan u1:30:合伙人 --plan u2:20 --token "$T"   # --dry-run 预演

# 记一笔流水；RECEIVED 会自动生成分成子条目
lawlink finance add-entry --matter-id <id> --type RECEIVED --amount 100000.00 --payer-or-payee "客户" --token "$T"
#   --type: RECEIVABLE(应收) | RECEIVED(实收) | REFUND(退费) | COST(成本)

lawlink finance delete-entry --fee-entry-id <feId> --token "$T"   # RECEIVED 会级联删分成；--dry-run 预演
lawlink finance show --matter-id <id> --token "$T"                # 单案台账 + 汇总
lawlink finance overview --months 6 --token "$T"                  # 全所台账（ADMIN/主任/财务）
```
