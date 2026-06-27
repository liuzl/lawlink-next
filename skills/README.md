# LawLink Skills — agent 操作手册（路由入口）

> 渐进披露（larksuite/cli §4.5）：**先读本页**（全局契约 + 概念消歧 + 域路由），
> 再按需打开某个域的 `SKILL.md`。内容种子来自 [`docs/DOMAIN-SPEC.md`](../docs/DOMAIN-SPEC.md)。

## 0. 一次调对的全局契约（所有命令通用）

- **运行**：`lawlink <域> <动作> [--flags]`（先 `pnpm --filter @lawlink/cli build`，或直接 `node packages/cli/dist/index.cjs …`）。
- **自描述**：`lawlink meta` 返回完整命令树 + 选项 + 本契约（agent 调用前先读它）。
- **输出信封**（stdout，单流，先 `JSON.parse` 再看 `.ok`）：
  - 成功 `{"ok":true,"data":…}`
  - 失败 `{"ok":false,"error":{"code","message","http"}}`
  - `--raw` → 成功只输出 data（stdout），失败输出到 stderr（便于管道）。
- **错误码 → 退出码**（可只看 `$?` 分支）：`0` 成功 · `2` VALIDATION/BAD_USAGE · `3` FORBIDDEN · `4` NOT_FOUND · `5` CONFLICT/INVALID_STATE · `1` INTERNAL。
- **认证**：`lawlink auth login --email … --password …` 拿 `token`；之后每条命令带 `--token <jwt>` 或设 `LAWLINK_TOKEN`。无 token 时本地模式用 env stub 身份（`LAWLINK_USER_ID`/`LAWLINK_ROLE`，仅本地开发）。
- **本地 vs 远程**：默认本地 libSQL；加 `--remote`（或 `LAWLINK_REMOTE=1`）打到线上部署；`--api-url`/`LAWLINK_API_URL` 改 base。
- **危险操作先预演**：变更类命令加 `--dry-run` → 只打印"将要执行的调用"（mode/method/target/input），**不执行**。读命令忽略 `--dry-run`。

## 1. 概念消歧（最容易调错的地方，务必先分清）

- **收案 Intake ≠ 案件 Matter**：Intake 是咨询登记（正式案件的前身）。经冲突检索+审批 `intake convert` 才生成 Matter。同一客户多次咨询分别建 Intake，**不做客户合并**。
- **案件 Matter ⊃ 程序 Procedure ⊃ 阶段 Stage**：一个 Matter 含 ≥1 个 Procedure（一审/二审/再审/执行…），**每个程序有独立案号/法院/立案日/开庭/期限**。"同一争议"是同一个 Matter，不要按案号拆成多个 Matter。
- **ENGAGED ≠ INFORMATIONAL**（程序参与方式）：`ENGAGED`=我方代理，进日程/期限/任务聚合；`INFORMATIONAL`=前序参考（他人代理），只存元数据，**不进任何聚合、不能加期限/开庭**。
- **诉讼地位下沉到程序**：同一人一审是"被告"、二审是"上诉人"——地位记在程序上（ProcedureParty）。
- **期限 Deadline / 开庭 Hearing 挂在"程序"上**；**日程 schedule** 是跨案聚合的只读视图。
- **卷宗 DocumentFolder ≠ 材料 Document**：卷宗是归档目录，材料归入卷宗。

## 2. 主线流程（按此顺序）

```
intake create → conflict check(前置门) → intake convert → matter add-procedure
  → [deadline compute · hearing add · document · finance · preservation · seal · sms]
  → archive checklist → archive do
```

## 3. 前置门（用某能力前必须满足）

| 要做 | 前置 |
|---|---|
| `intake convert`（转正式案件） | **先 `conflict check`**；命中 🔴 BLOCKING = 绝对冲突，不得继续（见 [conflict](conflict/SKILL.md)） |
| `deadline compute` / `hearing add` | 该程序须存在且为 **ENGAGED**（先 `matter add-procedure`） |
| `seal stamp`（盖章登记→STAMPED） | 必须提供盖章后扫描件 `--stamped-doc-id`（合规硬卡） |
| `archive do`（归档） | 先 `archive checklist`；缺必备项须 `--force-reason`（见 [archive](archive/SKILL.md)） |
| 创建用印/开票/保全、手动关联短信 | 只能挂在**当前用户主办/参与**的案件上（即便管理员） |

## 4. 域 → SKILL（按需打开）

| 域 | 何时用 | SKILL |
|---|---|---|
| 收案 | 登记咨询、转正式案件、不接案 | [intake/SKILL.md](intake/SKILL.md) |
| 冲突检索 | 接案前查利益冲突（执业红线） | [conflict/SKILL.md](conflict/SKILL.md) |
| 案件/程序/团队 | 看案件、加程序、设承办团队 | [matter/SKILL.md](matter/SKILL.md) |
| 期限 | 按事件推算法定期限、完成期限 | [deadline/SKILL.md](deadline/SKILL.md) |
| 财务 | 分成方案、记账（实收自动分成） | [finance/SKILL.md](finance/SKILL.md) |
| 财产保全 | 建保全、续保、到期预警 | [preservation/SKILL.md](preservation/SKILL.md) |
| 材料/卷宗 | 登记/上传材料、审核流转、卷宗 | [document/SKILL.md](document/SKILL.md) |
| 用印审批 | 用章申请→审批→盖章 | [seal/SKILL.md](seal/SKILL.md) |
| 法院短信 | 解析短信、一键生成开庭/期限 | [sms/SKILL.md](sms/SKILL.md) |
| 归档 | 完整性校验、结案归档 | [archive/SKILL.md](archive/SKILL.md) |
| 开票 | 开票申请→审批→开具 | [invoice/SKILL.md](invoice/SKILL.md) |
| 文书模板 | 上传模板、套模板生成文书 | [template/SKILL.md](template/SKILL.md) |

其余命令（`client` / `task` / `note` / `notification` / `schedule` / `report` / `user` / `settings`）粒度直观，`lawlink <域> --help` 即可。
