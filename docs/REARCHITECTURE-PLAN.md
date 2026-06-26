# LawLink 重构方案（架构重排路线）

> **状态**：规划 / 决策记录，尚未实施。
> **配套文档**：[`DOMAIN-SPEC.md`](./DOMAIN-SPEC.md)（业务规格）· [`SQLITE_D1_MIGRATION.md`](./SQLITE_D1_MIGRATION.md)（数据库迁移施工图）。
> 三件套关系：DOMAIN-SPEC = 重写"做什么"；本文 = 重写"怎么分层、对外怎么暴露"；SQLITE_D1_MIGRATION = 其中数据库一项的细节。
>
> 来源：基于 LawLink（原作者 叶森 / Sen Ye，MIT）。本文为框架无关的目标架构，不绑定具体技术栈。

## 目录
1. [触发动机与定性](#1-触发动机与定性)
2. [现状评估](#2-现状评估)
3. [目标架构](#3-目标架构)
4. [对外接口决策：CLI-first + Skills](#4-对外接口决策cli-first--skills)
5. [数据库与运行时目标](#5-数据库与运行时目标)
6. [迁移路线（分期）](#6-迁移路线分期)
7. [可复用 vs 需重建](#7-可复用-vs-需重建)
8. [开放决策与风险](#8-开放决策与风险)

---

## 1. 触发动机与定性

三个改造诉求：

1. **SQLite 换 PostgreSQL** —— 去掉 Docker，自部署零基础设施。
2. **Cloudflare 优先部署 + 本地部署兼容** —— 云原生为主，本地为辅。
3. **除 UI 外提供 CLI，便于各类 agent 使用** —— 多一个 agent-native 接口。

**定性结论：三者合起来构成一次"后端架构级重写"（大改），但不是从零重写。**

- 单看 #1：中等（schema 级）。
- #1+#2：显著改造，本质是移植（port）。
- **加 #3：升级为大改**——因为现状业务逻辑与 Web 框架焊死（见 §2），要让 Web 和 CLI 共享逻辑，必须抽出框架无关的核心层。

**关键洞察：#3 是最该主导整个改造的那个。** 它逼出的"干净核心 + 适配器边界"架构，反过来让 #1（换 DB）、#2（换运行时）退化成"换个适配器"的小事。三点不是三件成本，是同一次重构的三个收益。

> 这也是从 fork "毕业"成独立仓的自然节点：架构都重排了，与上游已无法 merge，DOMAIN-SPEC 即新核心层的蓝图。

---

## 2. 现状评估

对当前 Next.js + Prisma 实现的静态扫描：

| 事实 | 数字 | 含义 |
|---|---|---|
| `src/server` 业务逻辑文件 | 87 | 业务编排所在 |
| 其中依赖 next-auth / session | **51** | 业务逻辑与 Web 框架**耦合** |
| 用 Next 专有 API（revalidatePath / next/headers） | 31 | 同上 |
| `src/lib` 纯逻辑（不依赖 next） | 40（仅 2 个碰 next） | 已有干净层，但业务编排不在这 |
| 文件存储抽象（local / S3 双实现） | 已具备 | **可直接复用，接 R2 几乎免费** |
| CLI / bin 入口 | 0 | 仅几个一次性脚本 |

**结论**：没有独立的"核心层"，业务逻辑（含权限、编排）和 Next.js 的登录态、缓存机制缠在一起。这是大改的主要工作量来源；但存储抽象、DB 经 driver adapter 可换，是已有的有利条件。

---

## 3. 目标架构

```
                ┌──────────────── 入口适配器（薄壳） ────────────────┐
        Web UI            CLI（主 agent 接口）        (可选) MCP 薄壳
     (Next/OpenNext        + 默认 JSON 输出           给 MCP-native 宿主
      或更轻的栈)          + Skills 渐进披露
                          + 两层命令粒度
                └───────────────────────┬───────────────────────────┘
                          核心领域层 (= DOMAIN-SPEC)
                   纯函数：takes (db, authContext, input) → data
                   不依赖任何 Web 框架 / 登录态 / 缓存机制
                ┌───────────────────────┼───────────────────────────┐
            DB 适配器             存储适配器                调度适配器
       SQLite(本地)/D1(CF)     本地FS / R2(已抽象)      node-cron / Cron Triggers
```

### 3.1 核心领域层（重构的核心产物）
- 实现 `DOMAIN-SPEC.md` 的全部业务规则（三层模型、状态机、冲突分级、分成、期限、保全、归档校验…）。
- **签名约定**：每个用例是 `(deps, authContext, input) → Result`。
  - `deps` = 注入的 DB / 存储 / 时钟 / ID 生成器（便于测试与多适配）。
  - `authContext` = 显式传入的身份与角色（**不从 next-auth session 隐式取**）。
  - `input` = 已校验的入参（校验规则随核心层走，与 Zod 等具体库解耦或仅做薄封装）。
- **绝不依赖**：`next/*`、`revalidatePath`、`getServerSession`、`server-only`、请求上下文。
- 权限判断、可见范围过滤、脱敏全部在核心层完成（见 DOMAIN-SPEC §2、§6.2）。

### 3.2 适配器
| 适配器 | 本地 | Cloudflare |
|---|---|---|
| DB | SQLite（better-sqlite3 / libSQL） | D1（同为 SQLite 引擎） |
| 存储 | 本地文件系统 | R2（S3 兼容，复用现有抽象） |
| 调度 | node-cron | Cron Triggers |
| 加密 | node:crypto | WebCrypto / nodejs_compat（需验证） |

### 3.3 入口（薄壳）
- **Web UI**：渲染 + 调核心层。可继续 Next（经 OpenNext 上 CF），或后续换更轻的栈（见 §8）。
- **CLI**：见 §4，**主 agent 接口 + 人用 + 脚本/CI**。
- **MCP 薄壳**：可选，后置；包在同一核心层上，给 MCP-native 宿主用。

---

## 4. 对外接口决策：CLI-first + Skills

> **决策**：agent 接口以 **CLI** 为一等公民，**不以 MCP server 为主**。MCP 作为可选的后续适配器。
> **依据**：参考飞书官方 [larksuite/cli](https://github.com/larksuite/cli)——明确"built for humans and AI Agents"，200+ 命令、26 个 Agent Skills，对 agent 暴露 CLI 而非 MCP server（其仓内 MCP 仅作客户端）。

### 4.1 为什么 CLI-first 胜过 MCP server（本场景）

| 维度 | CLI + Skills | MCP server |
|---|---|---|
| 服务对象 | 人 + agent + 脚本 + CI，**一套接口** | 仅 agent → 仍需另做 CLI 给人/脚本 |
| token 效率 | Skills 按需加载**单个域**的 md | 把 N 个 tool schema **全塞**进上下文 |
| 覆盖面 | 可留 Raw 层无限覆盖，不必预定义每个工具 | 每个能力都要预建成一个 tool |
| 可组合 | 管道 / jq / shell / cron / CI 全生态 | 调用孤立 |
| 可移植 | 任何能跑 shell 的 harness | 仅 MCP-native 宿主且需配置 |

> 修正一个常见误解：MCP 并不更省 context。对操作较多的系统，MCP 要把所有 tool schema 一次性进上下文，而 Skills 是"用到哪个域才读哪个 md"，反而更省。

### 4.2 MCP 真正仍占优处（故保留为可选）
- 宿主是 MCP-native，想要进程内类型化调用、免 shell 转义；
- 需要有状态 / 流式 / 订阅 / sampling；
- 完全没有"人用 CLI / 脚本 / CI"诉求时。
→ 这些都不构成二选一：MCP 可作薄壳后置，复用同一核心层。

### 4.3 LawLink 的 CLI 设计（借鉴 lark，按自身裁剪）
- **命令粒度：两层即可**（lark 用三层；LawLink 操作面小，Raw 层可不做）：
  1. **快捷命令**（人/AI 友好，智能默认）：如 `lawlink intake +new`、`lawlink conflict +check`、`lawlink matter +open <id>`。
  2. **结构化命令**（1:1 用例）：如 `lawlink matters create`、`lawlink deadlines add`、`lawlink seals approve`。
- **输出**：默认 `--format json`（agent 友好），另支持 `table`（人）、`ndjson`/`csv`（批处理）。
- **Skills（markdown 渐进披露）**：每个业务域一个 `SKILL.md`（带 frontmatter + references/），agent 用到哪个域才读哪个。
  - **DOMAIN-SPEC.md 即 Skills 的种子**——其中收案 / 冲突 / 用印 / 开票 / 归档 / 保全 各节业务流程，直接对应一个 Skill。
- **身份与认证**：CLI 显式传身份（如 `--as <user>` 或 token），落到核心层的 `authContext`；非阻塞式登录便于 agent。
- **安全（借鉴 lark，agent 场景必做）**：输入注入防护、终端输出净化、凭据存 OS keychain、危险操作 `--dry-run` 预览 + 二次确认。

### 4.4 三个壳与核心层的关系
Web / CLI / MCP **都是薄壳**，只负责：解析输入 → 组装 `authContext` → 调核心层用例 → 格式化输出。**业务逻辑零重复**。这正是 CLI 不沦为附属品、而成为 agent-native 一等接口的前提。

### 4.5 可借鉴的 larksuite/cli 设计理念（P4 实施清单）

> 做 CLI 时**重点参考 [larksuite/cli](https://github.com/larksuite/cli) 的设计理念**。下列为提炼出的可落地原则，逐条对照实现：

1. **Agent-Native Design**：每个命令都用真实 agent 跑测，以"提高 agent 调用成功率"为目标——精简参数、智能默认、结构化输出。命令设计先问"agent 调得动吗"。
2. **一个接口同时服务人与 agent**：不分叉成两套工具；同一 CLI，人在终端用、agent 也用、脚本/CI 也用。
3. **分层命令粒度**：lark 用三层（Shortcuts → API Commands → Raw API）；LawLink 取两层（快捷 + 结构化），按需可加 Raw 层。让调用方按场景选粒度。
4. **Skills = 渐进披露**：每个域一个 `SKILL.md`（YAML frontmatter：name/version/description/requires/cliHelp）+ `references/` 子文档。要点：
   - **用决策表/路由表**（scenario → action）而非线性步骤；
   - **前置门**（用某能力前必须先读某 reference）；
   - **概念消歧**（如"案件 vs 程序""日历 vs 日程"这类易混概念先讲清）；
   - **按需加载**（agent 用到哪个域才读哪个 md，省 context）。
   - LawLink 的 Skills 内容直接以 `DOMAIN-SPEC.md` 各业务流程为种子。
5. **结构化输出为默认**：`--format json` 默认（agent），另备 `table`（人）、`ndjson`/`csv`（批处理）。
6. **agent 友好认证**：非阻塞登录（device-code 思路），便于无人值守 agent。
7. **安全是 agent 场景的硬约束**：输入注入防护、终端输出净化、凭据存 OS keychain、危险操作 `--dry-run` 预览 + 二次确认。
8. **智能默认 + 预览**：尽量减少必填参数、给出合理默认；变更类操作先 dry-run 预览再执行。

> 一句话理念：**把"能不能被 agent 一次调对"当作 CLI 的一等设计目标**，而不是先给人做完再让 agent 凑合。

---

## 5. 数据库与运行时目标

- **一套 SQLite 兼容 schema** 同时服务本地（SQLite）与云端（D1，同引擎）——使 #1、#2 天然统一。schema 降级细节见 [`SQLITE_D1_MIGRATION.md`](./SQLITE_D1_MIGRATION.md)（48 枚举 / 15 数组 / 11 Json / 删隔离级别 / 重生成 migration）。
- **Cloudflare 优先**：Workers + D1 + R2 + Cron Triggers；Next UI 经 OpenNext（Node 运行时）或换更轻的栈。
- **本地兼容**：同一核心层 + SQLite 文件 + 本地 FS + node-cron，`不依赖 Docker`。
- **待验证点**（CF 侧）：`node:crypto` 流式 AES-256-GCM 在 `nodejs_compat` 下能否跑通；`@napi-rs/canvas`（原生，1 处）需移除/替换；D1 配额（单库 10GB、单查询上限、仅 binding 访问）。

---

## 6. 迁移路线（分期）

> 顺序原则：**先立核心层，其余皆为适配器收尾**。

| 阶段 | 范围 | 产出 |
|---|---|---|
| **P0 决策** | 定独立仓 + 栈选型（UI 是否保留 Next；CLI 语言）；保留 LICENSE + 来源声明 | 新仓骨架 |
| **P1 核心层** | 按 DOMAIN-SPEC 从 51 个 server 文件剥业务逻辑，去 session 耦合 → `(deps, authContext, input)` 纯用例 + 单测 | 框架无关 core（大头） |
| **P2 DB/存储/调度 适配器** | SQLite 兼容 schema（按 SQLITE_D1_MIGRATION）+ 存储抽象复用 + 调度抽象 | 本地可跑、可换 D1/R2 |
| **P3 Web 薄壳** | 现 Web 改为调核心层；UI 组件大量复用 | UI 站在 core 上 |
| **P4 CLI + Skills** | 两层命令 + JSON 输出 + 安全；Skills（DOMAIN-SPEC 为种子）；**重点参考 larksuite/cli 设计理念，按 §4.5 清单实现** | agent-native 接口 |
| **P5 Cloudflare 落地** | D1 adapter + R2 + Cron Triggers + OpenNext；移除 canvas、验证 crypto | CF 优先部署 |
| **P6（可选）MCP 薄壳** | 包同一 core，给 MCP-native 宿主 | 可选 |
| **P7 补强规则** | 落 DOMAIN-SPEC §9：期限自动推算、保全到期预警、冲突召回增强、脱敏、风险代理/计时、归档 override | 从"记录"升级为"风控" |

---

## 7. 可复用 vs 需重建

| 可复用（价值资产） | 需重建 |
|---|---|
| 领域模型与业务规则（DOMAIN-SPEC） | 分层结构（core / adapter / 壳） |
| 业务算法本身（冲突分级、分成公式、期限规则、归档清单） | 业务逻辑与 next-auth/session 的解耦 |
| schema 设计（降级到 SQLite 兼容后） | DB / 存储 / 调度 适配层 |
| 1729 条规范案由 seed + 阶段模板 + 卷宗结构 | 新增 CLI + Skills 接口 |
| 文件存储 local/S3 抽象 | 运行时移植（node:crypto / canvas / cron） |
| React UI 组件 | （视 §8 决策，UI 框架可能更换） |

---

## 8. 开放决策与风险

1. **UI 框架是否保留 Next.js？** 核心层独立后，UI 成为可替换项。Next 经 OpenNext 上 CF 偏重；可考虑 Workers 上的轻量 API（如 Hono）+ 独立 SPA。**建议**：P1 先不动 UI，待核心层独立后再定（决策可推后）。
2. **CLI 用什么实现？** 与核心层同语言（TS/Node）最省事（直接 import core）；若要单文件分发可考虑编译。lark 用 Go 是因其 CLI 是独立客户端；LawLink CLI 直连自身 core，同语言更顺。
3. **CLI 的鉴权模型**：本地直连 core（按 OS 用户/配置）vs 走自身 HTTP API（token）。影响 `authContext` 来源。
4. **CF 运行时不确定点**：`node:crypto` 流式加密、原生 canvas——P5 前需先做可行性验证（spike）。
5. **D1 配额**：大律所材料量大时单库 10GB 上限需评估；材料走 R2 可缓解（DB 只存元数据）。
6. **独立仓与上游**：保留 `upstream` remote 可继续拉叶森更新作参考，但大改后基本不再 merge。

---

## 9. P0 技术栈选型（已定板）

> 决策日期记录：栈已拍板，作为 P1 起的实施基线。选型取向：**Cloudflare 原生、轻量、核心层与框架解耦**。

### 9.1 已锁定的栈

| 层 | 选定 | 备注 |
|---|---|---|
| 语言 / 运行时 | **TypeScript**（本地 Node / 云端 Workers `nodejs_compat`） | CLI 直接 `import` 核心层，零 IPC |
| 仓库形态 | **pnpm monorepo**（可选 Turborepo） | 结构见 §9.2 |
| 数据访问 | **Drizzle ORM** + drizzle-kit | 本地 better-sqlite3 / libSQL；云端 D1 binding。D1 一等支持、Workers 冷启友好、bundle 小 |
| 校验 | **Zod** | 随核心层走，框架无关 |
| API 层 | **Hono** | Workers 原生薄壳：request → 组 authContext → 调 core → JSON |
| Web UI | **Vite + React SPA** | 复用现有 React 组件（剥 server-action 耦合，改打 api）；路由 TanStack/React Router |
| CLI | TypeScript + commander/clipanion | 直接 import core；默认 JSON 输出；Skills=markdown（按 §4.5） |
| 鉴权 | **Hono 中间件 + JWT（jose）+ bcryptjs** | 替代 next-auth（见 §9.3 后果 1） |
| 存储 | local FS / R2（复用现有抽象） | 接 R2 几乎免费 |
| 调度 | node-cron（本地）/ Cron Triggers（CF） | |
| 部署 | Wrangler（api + cron）+ SPA 静态托管 | 本地 = node + sqlite 文件，**无 Docker** |
| 测试 | Vitest（沿用） | |

### 9.2 monorepo 结构

```
packages/
  core/   领域层（= DOMAIN-SPEC）；纯函数 (deps, authContext, input) → data
  db/     Drizzle schema + DB 适配（SQLite 本地 / D1 云端）
  cli/    agent-native CLI + Skills（薄壳，import core）
  mcp/    （可选，后置）MCP 薄壳
apps/
  api/    Hono HTTP API（Workers，薄壳）
  web/    Vite + React SPA（复用现有组件，打 api）
```

### 9.3 两个连带后果（选型引出，须纳入 P0/P1 范围）

1. **丢 Next.js = 丢 next-auth**：需新写轻量鉴权——Hono 中间件 + JWT（jose，Workers 友好）+ bcryptjs（沿用密码哈希）。Web 与 CLI 都从中取得 `authContext`。
2. **Drizzle 取代 Prisma**：[`SQLITE_D1_MIGRATION.md`](./SQLITE_D1_MIGRATION.md) 的**分析结论仍有效**（枚举/数组/Json 的 SQLite 限制一致，哪些字段拆关联表/转 JSON 的判断不变），仅**实现机制变**：枚举 → text + TS 联合类型；标量数组 → JSON text 列或 Drizzle 关联表（§B1 被查询的仍建议关联表）；Decimal → text（金额运算在核心层做）。

### 9.4 未锁定（按计划推后）
- CLI 具体库（commander vs clipanion）→ P4 定。
- 是否引入 Turborepo（vs 纯 pnpm workspaces）→ 视构建复杂度，P1 起视情况。
- 见 §8 其余开放项（CF 运行时 spike、D1 配额等）仍待验证。

---

*本方案基于 LawLink（叶森 / Sen Ye，MIT）整理，遵循 MIT 协议。CLI/Skills 设计参考 larksuite/cli（MIT）。*
