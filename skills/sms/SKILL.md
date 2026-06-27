---
name: lawlink-sms
version: 0.1.0
description: "法院短信解析 —— 入库解析→按案号匹配案件→一键生成开庭/期限。"
metadata:
  requires:
    bins: ["lawlink"]
    skills: ["matter", "deadline"]
  cliHelp: "lawlink sms --help"
---

# Skill: 法院短信解析 (SMS)

> 种子：DOMAIN-SPEC §5.6。流程：粘贴原文 → 本地正则解析 → 按案号反查程序匹配案件 → 一键生成开庭/期限。

## 流程 / 路由
```
sms ingest（解析+入库, 自动按案号匹配） → [未匹配] sms assign 手动关联案件
   → sms gen-hearing / sms gen-deadline（落到该案）→ 自动 processed=true
```
| 意图 | 操作 |
|---|---|
| 把一条法院短信入库解析 | `sms ingest --raw-text "…"` |
| 手动关联案件（自动没匹配上） | `sms assign --id <sid> --matter-id <id>` |
| 一键生成开庭 | `sms gen-hearing --id <sid> [--procedure-id …] [--starts-at …]` |
| 一键生成期限 | `sms gen-deadline --id <sid> [--procedure-id …] [--due-at …]` |
| 标记已处理/撤销 | `sms processed --id <sid> [--undo]` |

## 规则 / 前置门
- 生成开庭/期限前短信必须**已关联案件**（`matchedMatterId`）；否则 `INVALID_STATE`——先 `sms assign`。
- 目标程序须为 **ENGAGED**（同 [deadline](../deadline/SKILL.md)）。
- 开庭时间/到期日：能从短信解析则自动取，取不到须用 `--starts-at`/`--due-at` 显式给（否则 `VALIDATION`）。
- 生成是幂等的：重复点击/并发只会成功一次（已生成则 `INVALID_STATE`）；生成同时把短信置 `processed`。
- 解析纯本地正则（案号如 `(2026)沪01民终3520号`），不依赖外部 AI。

```bash
lawlink sms ingest --raw-text "(2026)沪01民初1234号 定于2026-08-01 09:30 在第三法庭开庭 …" --token "$T"
lawlink sms gen-hearing --id <sid> --procedure-id <pid> --starts-at 2026-08-01T09:30 --token "$T"  # --dry-run
```
