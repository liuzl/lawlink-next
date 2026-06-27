---
name: lawlink-archive
version: 0.1.0
description: "结案归档 —— 完整性清单校验 → 归档（案件转只读）；缺料需理由强制归档。"
metadata:
  requires:
    bins: ["lawlink"]
  cliHelp: "lawlink archive --help"
---

# Skill: 结案归档 (Archive)

> 种子：DOMAIN-SPEC §5.7、§6.6、§9.6。仅 ADMIN/PRINCIPAL_LAWYER 可归档。

## 前置门 + 关键规则
- **归档前先 `archive checklist`** 看必备材料是否齐全（按案件类别不同）。
- `archive do` 缺必备项会被拦截，除非给 `--force-reason`（强制归档需理由，审计留痕）——不要无理由强推。
- **归档不可逆**：案件转 `ARCHIVED` **只读**，之后所有正文写操作被服务端拦截（财务尾款仍可记）。归档前务必 `--dry-run` 确认。
- 幂等：已归档案件再次 `archive do` 返回既有归档记录（`alreadyArchived`）。

## 命令
```bash
lawlink archive checklist --matter-id <id> --token "$T"     # 返回该类别必备项 + 当前状态
lawlink archive do --matter-id <id> --summary "结案小结：…" \
  --checked 委托代理合同 --checked 裁判文书 --checked 办案小结 \
  --token "$T"                                              # 先 --dry-run 预演
# 缺必备项时强制归档：
lawlink archive do --matter-id <id> --summary "…" --force-reason "材料后补，主任同意" --token "$T"
```
- `--checked <item>` 可重复，列出已具备的必备项名称（与 checklist 返回的名称一致）。
- → `data` 含 `archiveId` / `missingItems` / `forced`。
