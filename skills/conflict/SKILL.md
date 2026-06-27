---
name: lawlink-conflict
version: 0.1.0
description: "利益冲突检索 —— 接案前的执业伦理红线检查。intake convert 的前置门。"
metadata:
  requires:
    bins: ["lawlink"]
  cliHelp: "lawlink conflict check --help"
---

# Skill: 利益冲突检索 (Conflict)

> 种子：DOMAIN-SPEC §6.2。**这是执业伦理红线**——接案/转正式案件前必跑。

## 何时用（前置门）
- **`intake convert` 之前必须先 `conflict check`**。命中 🔴 `BLOCKING` = 绝对冲突，**不得接案/不得 convert**。
- 检索范围 = **全所历史**（所有未删除案件的当事人 + 客户，含客户↔案件反查），不限当前用户。

## 分级矩阵（本次角色 × 历史命中角色）
| 本次 | 历史 | 等级 |
|---|---|---|
| 对方 | 我方客户 | 🔴 BLOCKING（曾代理的人现在成对方——绝对冲突） |
| 我方客户 | 对方 | 🟠 HIGH |
| 对方 | 对方 | 🟡 LOW |
| 我方客户 | 我方客户 | 🟡 LOW（回头客） |
| 第三人（任一侧） | — | 🟡 MEDIUM |

**加成**：命中**证件号精确匹配** → 等级 +1 档（封顶 BLOCKING）。所以查询尽量带 `--id-number`。

## check
```bash
lawlink conflict check --name "华东置业" --id-number 91310000XXXXXXXX0A \
  --candidate-role OPPOSING_PARTY --intake-id <id> --token "$T"
```
- `--candidate-role`: `CLIENT_PARTY|OPPOSING_PARTY|THIRD_PARTY`（本次该当事人的角色，默认 OPPOSING_PARTY）。
- `--intake-id` 可选，仅作审计关联。
- → `data` 含命中列表 + 最高等级。**agent 决策**：最高等级为 `BLOCKING` 时停止并告知用户；`HIGH` 提示人工复核。
