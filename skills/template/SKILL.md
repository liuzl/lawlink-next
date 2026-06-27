---
name: lawlink-template
version: 0.1.0
description: "文书模板 —— 上传 .docx 模板(自动识别变量)、预览缺失项、套模板生成文书并入卷。"
metadata:
  requires:
    bins: ["lawlink"]
  cliHelp: "lawlink template --help"
---

# Skill: 文书模板 (Template)

> 种子：DOMAIN-SPEC §5.5。生成时自动拼装上下文（律所抬头/案件/客户/当事人/当前程序/主办/今日），渲染 docx 并入库到对应卷宗（存上下文快照便于复核/重生成）。

## 路由
| 意图 | 操作 |
|---|---|
| 上传一个 .docx 模板 | `template upload` |
| 看模板列表（可按案件类别筛） | `template list [--matter-category …]` |
| 看模板变量与本案缺失项 | `template preview --template-id … --matter-id …` |
| 套模板生成文书（入卷） | `template generate --template-id … --matter-id …` |
| 删除模板 | `template delete --id …` |

## 命令
```bash
lawlink template upload --file ./起诉状模板.docx --name "民事起诉状" --category LITIGATION \
  --applicable CIVIL_COMMERCIAL --token "$T"
#   --category: INTAKE|RETAINER|LITIGATION|HEARING|WORK_PRODUCT|ARCHIVE|CLOSING|BLANK
lawlink template preview  --template-id <tid> --matter-id <id> --token "$T"   # 先看缺哪些变量
lawlink template generate --template-id <tid> --matter-id <id> --folder-id <fid> --token "$T"
```
- 建议：`generate` 前先 `preview` 确认无缺失变量（缺失会要求补全/回存源表）。
