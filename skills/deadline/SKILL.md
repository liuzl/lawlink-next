---
name: lawlink-deadline
version: 0.1.0
description: "法定期限 —— 按事件自动推算上诉期/答辩期/执行时效等并落到程序；完成期限。"
metadata:
  requires:
    bins: ["lawlink"]
    skills: ["matter"]
  cliHelp: "lawlink deadline --help"
---

# Skill: 法定期限 (Deadline)

> 种子：DOMAIN-SPEC §6.4 + §9.1（自动推算引擎，本系统最高价值能力）。

## 概念消歧
- **期限挂在"程序"上**，不是案件上。先有 ENGAGED 程序（见 [matter](../matter/SKILL.md)）。
- `compute` = **按事件自动推算法定期限**（民诉上诉 15 日 / 刑诉 10 日等，自事件次日起算，末日逢节假日顺延需人工核对）。不是手填到期日。

## 前置门
- 目标程序须存在且为 **ENGAGED**（`INFORMATIONAL` 程序 → `VALIDATION`，不进期限聚合）。

## compute（按事件推算）
```bash
lawlink deadline compute --procedure-id <pid> --event JUDGMENT_SERVED --event-date 2026-06-01 --token "$T"
```
- `--event`：`JUDGMENT_SERVED`(判决送达) | `RULING_SERVED`(裁定送达) | `COMPLAINT_SERVED`(起诉状副本送达) | `JUDGMENT_EFFECTIVE`(裁判生效) | `PERFORMANCE_DUE`(履行期届满) | `ARBITRATION_AWARD_RECEIVED`(收到仲裁裁决)。
- 幂等：对同一 (程序, 事件) 重算会**就地更新**已生成的自动期限（保留已"完成"标记），并清理规则不再产生的类别。重复调用安全。
- → `data.deadlines` 为推算出的期限列表（含到期日 + 依据 basis）。

## list / complete
```bash
lawlink deadline list --matter-id <id> --token "$T"
lawlink deadline complete --deadline-id <did> --token "$T"
```
- `list` 仅返回 ENGAGED 程序的期限（聚合视图口径）。

## 相关
- 跨案看临近到期：`lawlink schedule --from … --to …`、`lawlink dashboard`。
- 短信一键生成期限：见 [sms](../sms/SKILL.md) `sms gen-deadline`。
