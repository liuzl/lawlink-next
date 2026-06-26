---
name: lawlink-intake
version: 0.0.1
description: "收案登记 / intake registration —— create and manage intakes via the lawlink CLI."
metadata:
  requires:
    bins: ["lawlink"]
  cliHelp: "lawlink intake --help"
---

# Skill: 收案登记 (Intake)

> 模板 Skill，演示 §4.5 的设计：frontmatter + 决策表 + 概念消歧 + 按需加载。
> 内容种子来自 [`docs/DOMAIN-SPEC.md`](../../docs/DOMAIN-SPEC.md) §5.1。随 P1+ 用例补全而扩充。

## 概念消歧（先读）
- **Intake（收案）**：正式案件的前身，是一次咨询登记。**不是** Matter（正式案件）。
- 收案经"利益冲突检索 → 审批"后才 `转为正式案件`（生成 Matter）。详见 DOMAIN-SPEC §5.1。

## 意图路由
| 用户意图 | 操作 |
|---|---|
| "登记一个新咨询 / 新收案" | `lawlink intake create` |
| "把收案转成正式案件" | （P1+ 提供 `lawlink intake convert`） |
| "标记不接案" | （P1+ 提供 `lawlink intake decline`） |

## `lawlink intake create`
登记一条收案。任何已认证角色均可提交（DOMAIN-SPEC §5.1）。

**参数**
| 参数 | 必填 | 说明 |
|---|---|---|
| `--client-name <name>` | 是 | 委托方名称 |
| `--category <category>` | 是 | `CIVIL_COMMERCIAL` \| `CRIMINAL` \| `ADMINISTRATIVE` \| `NON_LITIGATION` \| `LEGAL_COUNSEL` \| `SPECIAL_PROJECT` |
| `--title <title>` | 否 | 留空按 `{委托方} 与 {对方} {案由}纠纷` 自动生成 |
| `--claim-amount <amount>` | 否 | 标的额，最多两位小数 |
| `--format <json\|text>` | 否 | 默认 `json` |

**示例（agent 友好，JSON 输出）**
```bash
lawlink intake create \
  --client-name "青石建设" \
  --category CIVIL_COMMERCIAL \
  --claim-amount 1250000.00 \
  --format json
```

**输出**：创建的 intake 对象（含 `id` / `status=INTAKE` / `createdAt`）。失败时输出 `{ "error": "..." }` 且退出码非 0。
