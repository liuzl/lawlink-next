---
name: lawlink-matter
version: 0.1.0
description: "案件 / 程序 / 承办团队 —— 查案件、加程序（一审/二审/执行…）、设主办协办助理。"
metadata:
  requires:
    bins: ["lawlink"]
  cliHelp: "lawlink matter --help"
---

# Skill: 案件 / 程序 / 团队 (Matter)

> 种子：DOMAIN-SPEC §3、§5.2、§2.2。先读 [README](../README.md) 的"案件⊃程序⊃阶段"消歧。

## 概念消歧（关键）
- **一案多程序**：同一争议 = 一个 Matter，无论一审/二审/再审/执行。**不要按案号拆成多个 Matter**——案号属于程序。
- **ENGAGED vs INFORMATIONAL**：加程序时选参与方式。`ENGAGED`(我方代理)进日程/期限聚合；`INFORMATIONAL`(前序参考)只存元数据，**不能加期限/开庭**。
- Matter 由 `intake convert` 生成（见 [intake](../intake/SKILL.md)），CLI 不直接 create matter。

## 意图路由
| 用户意图 | 操作 |
|---|---|
| 看我的案件列表 | `matter list` |
| 看某案件详情 | `matter show --matter-id <id>` |
| 给案件加一个程序 | `matter add-procedure` |
| 看/设承办团队 | `matter members` / `matter set-team` |

## add-procedure
```bash
lawlink matter add-procedure --matter-id <id> --type FIRST_INSTANCE --engagement ENGAGED \
  --case-number "(2026)沪01民初1234号" --handling-agency "上海一中院" --token "$T"
```
- `--type`：程序类型，须**适用于案件类别**（如民商事可 `FIRST_INSTANCE/SECOND_INSTANCE/ENFORCEMENT/…`，不适用会 `VALIDATION`(exit 2)）。首个程序不强制从一审开始。
- `--engagement`：`ENGAGED`(默认) | `INFORMATIONAL`。
- 仅 ADMIN/PRINCIPAL_LAWYER/LAWYER；须对该案有写权限（主办或成员）。

## set-team（整体替换承办团队 + 同步 ownerId）
```bash
lawlink matter set-team --matter-id <id> --owner <userId> \
  --co-lead u2,u3 --assistant u4 --token "$T"      # 加 --dry-run 预演
```
- 仅**当前主办**或管理角色可改；整体替换（不是增量）。
- 规则：主办/协办必须是律师角色；FINANCE 不能进团队（→ `VALIDATION`）。
- 去重优先级 owner > co-lead > assistant。
