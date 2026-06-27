# lawlink-next

> 面向中小律所 / 独立律师的案件管理系统——**agent-native 重写版**。
> 核心领域逻辑与框架解耦，对外提供 **Web UI + CLI（给人也给 agent）**，**同一套代码**本地（Node + libSQL）与云端（Cloudflare Workers + D1 + R2）都能跑。

> **本项目的领域模型与业务逻辑衍生自 [LawLink](https://github.com/lawflow-boop/LawLink)（原作者 叶森 / Sen Ye，MIT）。** 本仓是基于其领域设计、采用全新技术栈的重写，遵循 MIT 协议（见 [`LICENSE`](./LICENSE)）。

## 状态

**已上线 Cloudflare。** 全部领域逻辑迁入核心层；15 处交互式事务已改写为 D1 兼容的原子 `batch()` / 写时守卫；Web + API + CLI 均站在同一核心层上。

- **线上**：https://lawlink-next.zhanliangliu.workers.dev （Worker + D1 `lawlink-db` + R2 `lawlink-storage` + SPA assets）
- 同一 `apps/api/src/index.ts`（Hono app）既是 Node 入口（`server.ts`），也是 Workers 入口；运行时绑定从 `c.env` 注入（有 `DB`/`STORAGE` 用 D1/R2，否则回退本地 libSQL/fs）。

## 技术栈

| 层 | 选型 |
|---|---|
| 语言 | TypeScript（本地 Node / 云端 Workers `nodejs_compat`） |
| 仓库 | pnpm monorepo |
| 数据 | Drizzle ORM；本地 libSQL/SQLite，云端 **Cloudflare D1**（同引擎，原子 `batch()`，无交互式事务） |
| 存储 | 本地 FS / 云端 **R2** |
| API | Hono（一份 app，Node 与 Workers 共用） |
| Web | Vite + React SPA |
| CLI | TypeScript + commander；直接 import 核心层；JSON 信封输出 + 内嵌 Skills（见下） |
| 鉴权 | JWT（jose）+ bcryptjs |
| 部署 | Wrangler（D1 + R2 + assets） |

## 结构

```
packages/
  core/   领域层（纯用例 (deps, authContext, input) → data，框架无关；鉴权/事务规则都在这）
  db/     Drizzle schema + 客户端（createDb=libSQL / createD1Db=D1）
  cli/    agent-native CLI（薄壳，import core；可打本地或线上 API）
apps/
  api/    Hono HTTP API（index.ts = Node + Workers 双运行时单入口；server.ts=Node；wrangler.toml=CF）
  web/    Vite + React SPA
skills/   给 agent 的工作流/前置门文档（被 CLI 内嵌，见下）
docs/     设计文档
```

## 本地开发

```bash
pnpm install
pnpm typecheck                     # 全工作区类型检查

# 初始化本地库（libSQL 文件）+ 一个管理员
export LAWLINK_JWT_SECRET=$(openssl rand -hex 32)
pnpm --filter @lawlink/cli dev db migrate
pnpm --filter @lawlink/cli dev db seed          # admin@lawlink.local / ChangeMe!2026

pnpm dev                            # 并行起 API(:8787) + Web(Vite，代理 /api)
```

## CLI（agent-native）

同一个 CLI，人在终端用、agent 也用、脚本/CI 也用。设计参考飞书 [larksuite/cli](https://github.com/larksuite/cli)（见 `docs/REARCHITECTURE-PLAN.md` §4.5）。

```bash
pnpm --filter @lawlink/cli build    # 产出可直接 node 运行的 dist/index.cjs（bin: lawlink）
node packages/cli/dist/index.cjs meta   # 自描述：命令树 + 信封 + 退出码 + 认证 + skills 指引
```

要点：

- **结构化信封**（stdout，单流）：成功 `{"ok":true,"data":…}`，失败 `{"ok":false,"error":{code,message,http}}`；`--raw` 输出裸 data。
- **错误码 → 退出码**：`0` 成功 · `2` VALIDATION/用法 · `3` FORBIDDEN · `4` NOT_FOUND · `5` CONFLICT · `1` INTERNAL（连 commander 用法错误也转成 JSON）。
- **本地 / 远程**：默认本地 libSQL；加 `--remote`（或 `LAWLINK_REMOTE=1`，`--api-url`/`LAWLINK_API_URL` 改 base）打到线上部署。
- **危险操作预演**：变更类命令加 `--dry-run`，只打印"将要执行的调用"，不执行。
- **认证**：`lawlink auth login` 拿 token；之后 `--token` 或环境变量 `LAWLINK_TOKEN`。
- **内嵌 Skills**：`lawlink skills list` → `lawlink skills show <域>`（先 `skills show index`），按需读取该域的工作流与**前置门**（如 `intake convert` 前必须 `conflict check`）。

```bash
# 例：用 CLI 操作线上实例
T=$(node packages/cli/dist/index.cjs --remote --raw auth login --email you@x.co --password … \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
node packages/cli/dist/index.cjs --remote matter list --token "$T"
node packages/cli/dist/index.cjs --remote --dry-run archive do --matter-id M1 --summary 结案 --token "$T"
```

## 部署（Cloudflare）

需要 `CLOUDFLARE_API_TOKEN`（含 D1/R2/Workers 权限）+ 账户已开通 R2。

```bash
cd apps/api
wrangler d1 create lawlink-db                 # 把 database_id 填入 wrangler.toml
wrangler r2 bucket create lawlink-storage
pnpm d1:migrate:remote                        # 对远程 D1 应用迁移
wrangler secret put LAWLINK_JWT_SECRET
pnpm --filter @lawlink/web build              # 产出 SPA（assets 绑定）
wrangler deploy
```

本地用 `wrangler dev`（miniflare 起真实本地 D1+R2，无需账户）；先 `pnpm d1:migrate:local`。

## 设计文档

| 文档 | 内容 |
|---|---|
| [`docs/DOMAIN-SPEC.md`](./docs/DOMAIN-SPEC.md) | **框架无关的业务规格**——领域蓝图（Skills 的种子） |
| [`docs/REARCHITECTURE-PLAN.md`](./docs/REARCHITECTURE-PLAN.md) | 目标架构 + 分期路线 + 栈选型 + CLI/Skills 设计理念（§4.5） |
| [`docs/SQLITE_D1_MIGRATION.md`](./docs/SQLITE_D1_MIGRATION.md) | schema 降级到 SQLite/D1 兼容的清单 |
| [`docs/PRD.md`](./docs/PRD.md) · [`docs/DATA-MODEL.md`](./docs/DATA-MODEL.md) · [`docs/UI-DESIGN.md`](./docs/UI-DESIGN.md) | 原 LawLink 文档（参考） |
| [`skills/README.md`](./skills/README.md) | agent 操作手册（全局契约 + 概念消歧 + 前置门 + 域路由） |

## 许可与署名

MIT。领域模型与业务逻辑衍生自 LawLink（叶森 / Sen Ye）。法律期限 / 时效 / 保全期等细节须经执业律师按现行法复核后落地。
