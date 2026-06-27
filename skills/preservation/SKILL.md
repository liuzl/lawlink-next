---
name: lawlink-preservation
version: 0.1.0
description: "财产保全 —— 建保全（按财产类型定默认期限）、续保、到期扫描。漏续保=执业事故。"
metadata:
  requires:
    bins: ["lawlink"]
  cliHelp: "lawlink preservation --help"
---

# Skill: 财产保全 (Preservation)

> 种子：DOMAIN-SPEC §6.5、§9.2。**漏续保 = 冻结失效 = 执业事故**——续保规则要严守。

## 关键规则
- `expiryDate = startDate + duration(天)`，可用 `--duration-days` 覆盖；缺省按财产类型法定上限：
  | 财产类型 | 默认天数 |
  |---|---|
  | `BANK_DEPOSIT` 银行存款 | 365 |
  | `VEHICLE`/`OTHER` 车辆等动产 | 730 |
  | `REAL_ESTATE`/`EQUITY`/`IP` 房产/股权/知产 | 1095 |
- **续保**：`newExpiryDate` 必须 **晚于** 当前到期日；已到期失效的应"重新申请"而非续保；已解除(LIFTED)不可续。状态置 `RENEWED`。
- 到期预警窗口 `[30,15,7,3,1]` 天（由扫描任务驱动）。

## 命令
```bash
lawlink preservation create --matter-id <id> --type IN_LITIGATION --property-type BANK_DEPOSIT \
  --start-date 2026-06-01 --amount 500000.00 --respondent "华东置业" --token "$T"
#   --type: PRE_LITIGATION | IN_LITIGATION | ENFORCEMENT

lawlink preservation list  --matter-id <id> --token "$T"     # 含 daysToExpiry（临期/逾期可见）
lawlink preservation renew --preservation-id <pid> --new-expiry-date 2026-12-01 --note "续保" --token "$T"  # --dry-run
lawlink preservation scan                                     # 系统任务：标记已过期（cron 入口，无需 token）
```
