---
name: lawlink-document
version: 0.1.0
description: "材料 / 卷宗 —— 登记/上传材料、审核流转(草稿→入卷)、卷宗目录管理。"
metadata:
  requires:
    bins: ["lawlink"]
  cliHelp: "lawlink document --help"
---

# Skill: 材料 / 卷宗 (Document / Folder)

> 种子：DOMAIN-SPEC §3.1、§5.5、§7.2。

## 概念消歧
- **卷宗 DocumentFolder ≠ 材料 Document**：卷宗是案件内归档目录（建案时按类别自动生成默认结构）；材料归入卷宗。
- **register vs upload**：`register` 只登记元数据；`upload` 上传真实文件字节 + 登记。
- 文书审核生命周期：`DRAFT → PENDING_REVIEW → APPROVED → FILED`（可从 PENDING_REVIEW 退回 DRAFT）。**审核通过(approve)仅管理角色**。

## 卷宗 folder
```bash
lawlink folder list   --matter-id <id> --token "$T"
lawlink folder create --matter-id <id> --name "证据材料" --token "$T"   # 重名 → CONFLICT(exit 5)
lawlink folder rename --folder-id <fid> --name "新名" --token "$T"
lawlink folder delete --folder-id <fid> --token "$T"   # 仅非默认、空卷宗可删；--dry-run 预演
```

## 材料 document
```bash
lawlink document register --matter-id <id> --name "起诉状" --category PLEADING --folder-id <fid> --token "$T"
lawlink document upload   --matter-id <id> --file ./证据.pdf --category EVIDENCE --folder-id <fid> --token "$T"
lawlink document download --id <docId> --out ./out.pdf --token "$T"
lawlink document list     --matter-id <id> --token "$T"
lawlink document move     --document-id <docId> --folder-id <fid> --token "$T"   # 省略 folder-id = 移出到根
# 审核流转（document-id）：
lawlink document submit   --document-id <docId> --token "$T"   # DRAFT → PENDING_REVIEW
lawlink document approve  --document-id <docId> --token "$T"   # PENDING_REVIEW → APPROVED（管理角色）
lawlink document reject   --document-id <docId> --reason "缺页" --token "$T"   # 退回 DRAFT（管理角色）
lawlink document file     --document-id <docId> --token "$T"   # APPROVED → FILED（入卷）
lawlink document delete   --document-id <docId> --token "$T"   # 软删除；--dry-run 预演
```
- `--category`: `EVIDENCE|PLEADING|PROCEDURE|JUDGMENT|CONTRACT|OTHER`。
- 状态不符的流转 → `INVALID_STATE`(exit 5)（如对非 DRAFT 调 submit）。
- 归档(ARCHIVED)案件只读：材料写操作被服务端拦截。
