# lawlink-next

> 面向中小律所 / 独立律师的案件管理系统——**agent-native 重写版**。
> 核心领域逻辑与框架解耦，对外提供 **Web UI + CLI（给 agent）+ 可选 MCP**，部署 **Cloudflare 优先、本地兼容（无 Docker）**。

> **本项目的领域模型与业务逻辑衍生自 [LawLink](https://github.com/lawflow-boop/LawLink)（原作者 叶森 / Sen Ye，MIT）。** 本仓是基于其领域设计、采用全新技术栈的重写，遵循 MIT 协议（见 [`LICENSE`](./LICENSE)）。

## 状态

**P0：仓库骨架已搭建。** 业务逻辑尚未迁入（P1 起）。当前可 `pnpm install && pnpm typecheck` 通过，验证分层与跨包接线成立。

## 技术栈（决策见 `docs/REARCHITECTURE-PLAN.md` §9）

| 层 | 选型 |
|---|---|
| 语言 | TypeScript（本地 Node / 云端 Workers `nodejs_compat`） |
| 仓库 | pnpm monorepo |
| 数据 | Drizzle ORM（本地 libSQL/SQLite，云端 D1） |
| API | Hono（Workers 原生薄壳） |
| Web | Vite + React SPA |
| CLI | TypeScript，直接 import 核心层；JSON 输出 + Skills |
| 鉴权 | JWT（jose）+ bcryptjs |
| 部署 | Wrangler（API + Cron Triggers）+ SPA 静态托管 |

## 结构

```
packages/
  core/   领域层（纯函数 (deps, authContext, input) → data，不依赖任何框架）
  db/     Drizzle schema + DB 适配（SQLite 本地 / D1 云端）
  cli/    agent-native CLI（薄壳，import core）
apps/
  api/    Hono HTTP API（Workers 薄壳）
  web/    Vite + React SPA
docs/     设计文档（见下）
```

> `packages/mcp/`（MCP 薄壳）按计划后置，暂未创建。

## 设计文档

| 文档 | 内容 |
|---|---|
| [`docs/DOMAIN-SPEC.md`](./docs/DOMAIN-SPEC.md) | **框架无关的业务规格**——重写的蓝图 |
| [`docs/REARCHITECTURE-PLAN.md`](./docs/REARCHITECTURE-PLAN.md) | 目标架构 + 分期路线 + P0 栈选型 + CLI 设计理念 |
| [`docs/SQLITE_D1_MIGRATION.md`](./docs/SQLITE_D1_MIGRATION.md) | schema 降级到 SQLite/D1 兼容的清单 |
| [`docs/PRD.md`](./docs/PRD.md) · [`docs/DATA-MODEL.md`](./docs/DATA-MODEL.md) · [`docs/UI-DESIGN.md`](./docs/UI-DESIGN.md) | 原 LawLink 文档（参考） |

## 本地开发

```bash
pnpm install
pnpm typecheck
```

（各包的运行/迁移脚本随 P1+ 逐步补全。）

## 许可与署名

MIT。领域模型与业务逻辑衍生自 LawLink（叶森 / Sen Ye）。法律期限 / 时效 / 保全期等细节须经执业律师按现行法复核后落地。
