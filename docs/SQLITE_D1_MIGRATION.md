# SQLite / Cloudflare D1 兼容化改造清单

> 状态：**只读评估 / 施工图**，尚未实施。
> 适用范围：把数据库从 PostgreSQL 迁到 **本地 SQLite** 或 **Cloudflare D1**（两者同一引擎，schema 改造完全共用）。
> 评估依据：对 `prisma/schema.prisma` 与 `src/` 的静态扫描（截至 main 分支）。

---

## 0. 背景与结论

当前 `datasource` 为 `postgresql`，schema 大量使用 PG 专有特性：**48 个 `enum`**、**15 个标量数组字段**、**11 个 `Json` 字段**、以及 3 处 `Serializable` 事务隔离。Prisma 的 SQLite connector（D1 走的也是它）**不支持**前三类，因此迁移不是改一行 `provider`，而是一次 schema 级改造。

**好在两点让改造比预期可控：**

1. **所有 Json 字段都不被按路径查询**（代码里的 `path:[...]` 全是 Zod 校验路径，不是 Prisma JSON 查询）→ 11 个 Json 可无损转 `String`。
2. **所有枚举在应用层已有 Zod 白名单校验** → 去掉 DB 枚举约束后由 Zod 兜底，不丢校验。

**真正需要动脑的只有 5 处被查询的数组字段（B1）。** 其余都是机械替换或删除。

**总工作量预估：1.5–2.5 天**（含回归测试）。

| 类别 | 数量 | 改 schema | 改业务代码 | 难度 |
|---|---|---|---|---|
| A 枚举 → String | 48 枚举 / 66 字段 | ✅ | Zod 已兜，基本不动 | 机械，量大 |
| B1 被查询的数组 | 5 字段 | ✅ | ✅ 重写 5 处查询（1 处拆关联表） | **中，有逻辑** |
| B2 静态数组 | 10 字段 | ✅ | 读写包 JSON ~10 处 | 机械 |
| C Json → String | 11 字段 | ✅ | 读写包 JSON ~11 处 | 机械，最省事 |
| D 删事务隔离级别 | 3 处 | — | ✅ 删参数 | 极易 |
| E 重生成 migration | 41 → 1 | ✅ | — | 易 |

---

## A. 枚举 → String（48 个枚举，66 处字段）

**改法**：`provider` 改为 `sqlite` 后，删除全部 48 个 `enum {}` 块；所有 66 处使用这些枚举的字段类型改成 `String`；默认值改为字符串字面量（如 `status MatterStatus @default(IN_PROGRESS)` → `status String @default("IN_PROGRESS")`）。

**安全性**：不丢校验。应用层 Zod schema 已对所有枚举做白名单校验，DB 层约束去掉后由 Zod 兜住。`@relation`、`@@index`、`@@unique` 均不受影响，只改字段标量类型。

### 48 个枚举（全部转 String）

```
UserRole, MatterCategory, MatterStatus, MatterMemberRole, IntakeStatus,
LitigationStanding, FeeType, InvoiceType, InvoiceItem, InvoiceRequestStatus,
DocumentStatus, ProcedureType, ProcedureStatus, ProcedureEngagement,
ProcedureOutcome, PartyRole, PartyType, BarFilingType, ClientType,
ClientCooperationStatus, ClientGender, ConflictSeverity, ConflictConclusion,
DeadlineCategory, NoteChannel, DocumentCategory, BillingStatus, FeeEntryType,
TemplateCategory, SealType, SealRequestStatus, Urgency, CustomFieldEntity,
CustomFieldType, ArchiveStatus, ArchiveClosedReason, SmsType, SmsMatchSource,
PreservationType, PropertyType, GuaranteeType, PreservationStatus,
ExpressDirection, NotificationType, NotificationPriority, FirmFileCategory,
ExternalContactCategory, ExternalContactStatus
```

### 66 处字段使用（逐个改类型）

```
User.role                            Client.type
Client.cooperationStatus             Client.gender?
CauseOfAction.category               Intake.category
Intake.status                        Intake.clientType?
Intake.firstProcedureType?           Intake.ourStanding?
Intake.barFiling?                    Intake.feeType?
Matter.category                      Matter.status
Matter.ourStanding?                  Matter.barFiling?
CustomFieldDef.entityType            CustomFieldDef.fieldType
MatterMember.role                    MatterProcedure.type
MatterProcedure.engagement           MatterProcedure.ourStanding?
MatterProcedure.status               MatterProcedure.outcome?
Deadline.category                    Party.role
Party.standing?                      Party.partyType
ProcedureParty.standing              ConflictCheck.conclusion
ConflictHit.severity                 Note.channel
Document.category                    Document.status
InvoiceRequest.status                InvoiceRequest.invoiceType?
InvoiceRequest.invoiceItem?          Billing.status
FeeEntry.type                        ArchiveRecord.closedReason?
ArchiveRecord.status                 StageTemplate.procedureType
DocumentTemplate.category            DocumentTemplate.applicableCategories[]  (见 B1)
SealTypeConfig.type                  SealTypeConfig.approverRoles[]           (见 B2)
SealRequest.sealType                 SealRequest.urgency
SealRequest.status                   SmsMessage.smsType
SmsMessage.matchedBy                 Preservation.type
Preservation.propertyType            Preservation.guaranteeType?
Preservation.status                  PreservationCase.type
PreservationCase.status              PreservationCase.guaranteeType?
PreservationProperty.propertyType    PreservationProperty.status
ExpressTracking.direction            Notification.type
Notification.priority                FirmFile.category
ExternalContact.category             ExternalContact.status
```

---

## B. 标量数组（15 个）→ 分两种改法

### B1. ⚠️ 被查询的数组（5 个）——必须拆关联表 或 改 LIKE 模拟

这些用了 `{ has: }` / `{ isEmpty: }`，`String` 列上没有这些操作符，**不能简单转 JSON 字符串**：

| 字段 | 查询点 | 推荐改法 |
|---|---|---|
| `Intake.coUserIds : String[]` | `src/lib/permissions/index.ts:161`、`src/server/intakes/actions.ts:256`（**权限过滤，安全敏感**） | **拆关联表** `IntakeCoUser(intakeId, userId)`，保证权限查询正确 |
| `DocumentTemplate.applicableCategories : MatterCategory[]` | `src/app/(app)/matters/[id]/page.tsx:62`、`src/server/document-templates/actions.ts:31`（`has` + `isEmpty`） | 拆关联表，或存逗号串 + `contains` 模拟（`isEmpty` → 判空串） |
| `Client.tags : String[]` | `src/server/clients/actions.ts:38`、`src/server/search/actions.ts:80`（`has`） | 标签搜索，可接受 **逗号串 + `contains` LIKE** |
| `Document.tags : String[]` | `src/server/documents/actions.ts:265`、`search` | 同上，`contains` LIKE |
| `FirmFile.tags : String[]` | `src/server/firm-files/actions.ts:79` | 同上，`contains` LIKE |

> **`coUserIds` 强烈建议拆关联表**：它是权限判断，逗号串 + LIKE 有 `userId` 子串误命中风险（如 `id=abc` 命中 `abcd`）。三个 `tags` 是模糊搜索，LIKE 误命中可接受。

### B2. ✅ 不被查询的数组（10 个）——直接转 JSON 字符串

存 `String`，读写时 `JSON.parse` / `JSON.stringify` 包一层：

```
CauseOfAction.keywords : String[]          CustomFieldDef.options : String[]
Note.tags : String[]                       Note.attachments : String[]
InvoiceRequest.evidenceDocIds : String[]   ArchiveRecord.missingItems : String[]
SealTypeConfig.approverRoles : UserRole[]  Preservation.remindDays : Int[]
PreservationCase.remindDays : Int[]        ExternalContact.tags : String[]
```

> `remindDays` 默认值 `[30, 15, 7, 3, 1]` → 改成 `@default("[30,15,7,3,1]")` 存 JSON 串，读出后 `JSON.parse`。

---

## C. Json 字段（11 个）→ String + JSON.parse ✅ 全部安全

经核实**无一个被 Prisma 按 JSON 路径查询**，都是「存快照、应用层解析」。改 `String`，读写包 `JSON.parse` / `JSON.stringify`：

```
Matter.customValues            ConflictCheck.queryPayload      Document.templateContextSnapshot
ArchiveRecord.checklistJson    AuditLog.detail                 StageTemplate.steps
SystemSetting.value            DocumentTemplate.variables      SmsMessage.parsedJson
ExpressTracking.tracesJson     ReviewRecord.itemsJson
```

> 这是整个改造里**最省事**的一类——纯机械包装，无查询语义损失。建议封装一个 `jsonField` 读写小工具集中处理，避免散落的 parse/stringify。

---

## D. Serializable 事务隔离（3 处）→ 删参数

SQLite / D1 不支持设置事务隔离级别。删掉 `{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }`：

```
src/server/matters/code-generator.ts:22
src/server/clients/code-generator.ts:26
src/server/seals/actions.ts:54
```

> **不影响流水号安全**：SQLite 写操作本身全局串行（文件锁），计数器仍原子；D1 同理（单点写）。

---

## E. Migration（41 个）→ 全部重生成

现有 41 个 migration 是 PG 方言（数组 / 枚举 / 类型），SQLite 跑不了。

1. 删除 `prisma/migrations/`
2. `provider` 改 `sqlite`，schema 完成 A–D 改造
3. `prisma migrate dev --name init_sqlite` 重新生成一套全新初始 migration
4. Seed 逻辑（1729 条案由、阶段模板、用章配置等）**不变**，只是底层 SQL 重建

---

## F. 仅当目标是 Cloudflare D1（而非本地 SQLite）时的额外工作

schema 完成 A–E 后，再叠加：

1. **Prisma driver adapter**：换 `@prisma/adapter-d1`，开启 `driverAdapters` preview feature。
2. **文件存储 → R2**：`src/lib/storage/` 已抽象 local / S3 双实现，R2 为 S3 兼容，设 `STORAGE_PROVIDER=s3` 指向 R2 即可（**几乎免费迁移**）。
3. **定时任务 → Cron Triggers**：`src/server/cron/scheduler.ts` 的 `node-cron` 在 Workers 无常驻进程，改用 Cloudflare Cron Triggers 调度。
4. **去掉原生模块**：`src/server/ai/parse-pleading.ts` 用了 `@napi-rs/canvas`（原生二进制），Workers 不支持，需移除或换纯 JS 实现。
5. **验证 `node:crypto`**：`src/lib/storage/crypto.ts` 的流式 AES-256-GCM 与 `src/lib/express/track.ts` 的 md5 签名，需在 `nodejs_compat` 下验证（较新 workerd 已较好 polyfill，但流式加密要实测）。
6. **D1 配额**：单库 10 GB、单查询行数 / 响应体大小有上限、只能经 Workers binding 访问（不能像本地 SQLite 直连文件）。

---

## G. 决策建议

- **目标 = 自部署少一个容器** → 优先评估 **PGlite**（Postgres WASM 进程内嵌，**schema 零改造**，保留枚举 / 数组 / Json）；其次才是本节的 SQLite 改造。
- **目标 = serverless / 全球 / 免服务器** → 走 **OpenNext + Hyperdrive + 托管 PG + R2 + Cron Triggers**，**schema 不动**，工作量最小。
- **目标 = 全 Cloudflare 原生、零外部数据库** → 才执行本文 A–F 全套（SQLite 改造 + D1 适配）。

> 换言之：本文的 SQLite 改造，**只有在"要本地 SQLite"或"要全 D1"两种目标下才值得做**。若只是想精简自部署或上 Cloudflare 计算，有更省事的路径。

---

*生成方式：对 schema 与源码的静态分析。实施前请以最新代码复核字段清单（schema 仍在迭代）。*
