---
name: lawlink-intake
version: 0.1.0
description: "收案登记 / intake registration —— 登记咨询、查冲突后转正式案件、不接案。"
metadata:
  requires:
    bins: ["lawlink"]
    skills: ["conflict"]
  cliHelp: "lawlink intake --help"
---

# Skill: 收案登记 (Intake)

> 先读 [skills/README.md](../README.md) 的全局契约 + 概念消歧。种子：DOMAIN-SPEC §5.1。

## 概念消歧
- **Intake（收案）= 咨询登记，不是 Matter（正式案件）**。`convert` 后才生成 Matter。
- 同一客户多次咨询分别建 Intake，不合并客户。

## 意图路由
| 用户意图 | 操作 | 说明 |
|---|---|---|
| 登记一个新咨询/收案 | `intake create` | 任何已认证角色可提交 |
| 查这条收案能不能接（冲突） | 先 `conflict check`（见 [conflict](../conflict/SKILL.md)） | **convert 的前置门** |
| 转成正式案件 | `intake convert` | 仅 ADMIN/PRINCIPAL_LAWYER；生成 Matter + 编号 + 卷宗 + 主办 |
| 不接案 | `intake decline` | 仅 ADMIN/PRINCIPAL_LAWYER；需 `--reason` |

## 前置门
- **convert 前必须 `conflict check`**：命中 🔴 `BLOCKING` 为绝对冲突，**不得 convert**。
- convert 不可逆（生成 Matter、收案转 CONVERTED）；不确定先 `--dry-run`。

## create
```bash
lawlink intake create --client-name "青石建设" --category CIVIL_COMMERCIAL --claim-amount 1250000.00 --token "$T"
```
`--category`: `CIVIL_COMMERCIAL|CRIMINAL|ADMINISTRATIVE|NON_LITIGATION|LEGAL_COUNSEL|SPECIAL_PROJECT`。
`--title` 留空自动生成；可选 `--client-id-number/--opposing-name/--opposing-id-number`。
→ `data` 为 intake 对象（`id`/`status=INTAKE`）。

## convert
```bash
lawlink intake convert --intake-id <id> --token "$T"      # 加 --dry-run 预演
```
→ `data.matterId` + `internalCode`（如 `LL-2026-CC-0001`）。已是终态的收案重复 convert → `INVALID_STATE`(exit 5)。

## decline
```bash
lawlink intake decline --intake-id <id> --reason "存在利益冲突" --token "$T"
```
