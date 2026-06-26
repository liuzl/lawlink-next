#!/usr/bin/env node
/**
 * lawlink CLI — agent-native entry shell.
 *
 * A thin adapter over @lawlink/core: parse args -> assemble Deps + AuthContext
 * -> call a core use case -> print structured JSON (default). See
 * docs/REARCHITECTURE-PLAN.md §4 (CLI design) and §4.5 (larksuite-inspired
 * principles). Business logic lives entirely in @lawlink/core.
 */
import { randomUUID } from "node:crypto";
import { Command } from "commander";
import {
  addContact,
  addHearing,
  addNote,
  addProcedure,
  addTask,
  archiveMatter,
  createAuditSink,
  getArchiveChecklist,
  listAudit,
  applyDeadlineRules,
  completeDeadline,
  completeTask,
  convertIntake,
  listMatterHearings,
  listMatterNotes,
  listMatterTasks,
  createClient,
  createFeeEntry,
  createIntake,
  createPreservation,
  createFolder,
  renameFolder,
  deleteFolder,
  listFolders,
  registerDocument,
  listDocuments,
  moveDocument,
  submitDocumentForReview,
  approveDocument,
  rejectDocument,
  fileDocument,
  deleteDocument,
  declineIntake,
  deleteFeeEntry,
  getClient,
  getDashboard,
  getMatter,
  getMatterFinance,
  setCommissionPlan,
  hashPassword,
  listClients,
  listMatterDeadlines,
  listMatterPreservations,
  listMatters,
  login,
  renewPreservation,
  scanPreservationExpiry,
  requireJwtSecret,
  runConflictCheck,
  verifyToken,
  type AuthContext,
  type Deps,
  type Role,
} from "@lawlink/core";
import { createDb, runMigrations, users } from "@lawlink/db";

/** Resolve the real JWT secret — throws if unset/placeholder (no fallback). */
function getSecret(): string {
  return requireJwtSecret(process.env.LAWLINK_JWT_SECRET);
}

/** Deps. `secret` is only needed by token-issuing use cases (login). */
function buildDeps(secret = ""): Deps {
  const url = process.env.LAWLINK_DB_URL ?? "file:./lawlink.db";
  const db = createDb(url);
  const ids = { newId: () => randomUUID() };
  const clock = { now: () => new Date() };
  return { db, ids, clock, secrets: { jwt: secret }, audit: createAuditSink(db, ids, clock) };
}

/** Resolve the caller: a verified token if given, else an env stub (dev only). */
async function resolveAuth(token?: string): Promise<AuthContext> {
  if (token) return verifyToken(getSecret(), token);
  return {
    userId: process.env.LAWLINK_USER_ID ?? "cli-user",
    role: (process.env.LAWLINK_ROLE as Role) ?? "LAWYER",
  };
}

function emit(format: string, data: unknown): void {
  if (format === "text") process.stdout.write(String(data) + "\n");
  else process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

/** Run an action, printing JSON errors and setting a non-zero exit code.
 * `Promise.resolve().then(fn)` also captures synchronous throws (e.g. a
 * missing JWT secret evaluated while building deps). */
function run(fn: () => Promise<unknown>, format = "json"): void {
  Promise.resolve()
    .then(fn)
    .then((data) => emit(format, data))
    .catch((err) => {
      emit("json", { error: err instanceof Error ? err.message : String(err) });
      process.exitCode = 1;
    });
}

const program = new Command();
program
  .name("lawlink")
  .description("LawLink CLI — case management for lawyers, built for humans and agents")
  .version("0.0.0");

// ── db ────────────────────────────────────────────────────────────────────
const db = program.command("db").description("数据库维护");

db.command("migrate")
  .description("Apply pending migrations")
  .action(() =>
    run(async () => {
      await runMigrations(buildDeps().db);
      return { migrated: true };
    }),
  );

db.command("seed")
  .description("Seed an admin + a sample lawyer account")
  .action(() =>
    run(async () => {
      const deps = buildDeps();
      const now = deps.clock.now();
      const accounts = [
        { email: "admin@lawlink.local", name: "系统管理员", role: "ADMIN", pw: process.env.LAWLINK_SEED_PASSWORD ?? "ChangeMe!2026" },
        { email: "lawyer@lawlink.local", name: "示例律师", role: "LAWYER", pw: "lawyer123" },
      ];
      const rows = await Promise.all(
        accounts.map(async (a) => ({
          id: deps.ids.newId(),
          name: a.name,
          email: a.email,
          passwordHash: await hashPassword(a.pw),
          role: a.role,
          active: true,
          createdAt: now,
        })),
      );
      await deps.db.insert(users).values(rows);
      // Provisioning privileged identities (incl. the default admin) is itself
      // an audit-worthy event — record it under a SYSTEM actor. No passwords or
      // hashes in the detail, only id/email/role.
      for (const r of rows) {
        await deps.audit.record(
          { userId: "system" },
          { action: "USER_SEED", targetType: "User", targetId: r.id, detail: { email: r.email, role: r.role } },
        );
      }
      return { seeded: accounts.map((a) => ({ email: a.email, role: a.role })) };
    }),
  );

// ── auth ──────────────────────────────────────────────────────────────────
const auth = program.command("auth").description("登录与身份");

auth
  .command("login")
  .requiredOption("--email <email>")
  .requiredOption("--password <password>")
  .action((opts) => run(() => login(buildDeps(getSecret()), opts)));

auth
  .command("whoami")
  .requiredOption("--token <token>")
  .action((opts) => run(() => resolveAuth(opts.token)));

// ── intake ──────────────────────────────────────────────────────────────────
const intake = program.command("intake").description("收案登记 / intake registration");

intake
  .command("create")
  .requiredOption("--client-name <name>", "委托方名称")
  .requiredOption("--category <category>", "案件类别")
  .option("--client-id-number <id>", "委托方证件号")
  .option("--opposing-name <name>", "对方名称")
  .option("--opposing-id-number <id>", "对方证件号")
  .option("--title <title>", "标题（留空自动生成）")
  .option("--claim-amount <amount>", "标的额（最多两位小数）")
  .option("--token <token>", "登录态（缺省用 env stub）")
  .option("--format <format>", "json|text", "json")
  .action((opts) =>
    run(
      async () =>
        createIntake(buildDeps(), await resolveAuth(opts.token), {
          title: opts.title,
          category: opts.category,
          clientName: opts.clientName,
          clientIdNumber: opts.clientIdNumber,
          opposingName: opts.opposingName,
          opposingIdNumber: opts.opposingIdNumber,
          claimAmount: opts.claimAmount,
        }),
      opts.format,
    ),
  );

intake
  .command("decline")
  .description("标记不接案（仅 ADMIN / PRINCIPAL_LAWYER）")
  .requiredOption("--intake-id <id>")
  .requiredOption("--reason <reason>")
  .requiredOption("--token <token>", "登录态")
  .action((opts) =>
    run(async () =>
      declineIntake(buildDeps(), await resolveAuth(opts.token), {
        intakeId: opts.intakeId,
        reason: opts.reason,
      }),
    ),
  );

intake
  .command("convert")
  .description("转为正式案件（仅 ADMIN / PRINCIPAL_LAWYER）")
  .requiredOption("--intake-id <id>")
  .requiredOption("--token <token>", "登录态")
  .action((opts) =>
    run(async () =>
      convertIntake(buildDeps(), await resolveAuth(opts.token), {
        intakeId: opts.intakeId,
      }),
    ),
  );

// ── conflict ────────────────────────────────────────────────────────────────
program
  .command("conflict")
  .description("利益冲突检索")
  .command("check")
  .option("--name <name>", "当事人名称")
  .option("--id-number <id>", "证件号")
  .option("--candidate-role <role>", "本次角色 CLIENT_PARTY|OPPOSING_PARTY|THIRD_PARTY", "OPPOSING_PARTY")
  .option("--intake-id <id>", "关联收案（审计）")
  .option("--token <token>", "登录态")
  .action((opts) =>
    run(async () =>
      runConflictCheck(buildDeps(), await resolveAuth(opts.token), {
        name: opts.name,
        idNumber: opts.idNumber,
        candidateRole: opts.candidateRole,
        intakeId: opts.intakeId,
      }),
    ),
  );

program
  .command("dashboard")
  .description("工作台聚合（近期到期等）")
  .option("--token <token>", "登录态")
  .action((opts) => run(async () => getDashboard(buildDeps(), await resolveAuth(opts.token))));

// ── client ──────────────────────────────────────────────────────────────────
const client = program.command("client").description("客户 / 联系人");

client
  .command("create")
  .requiredOption("--name <name>")
  .option("--type <t>", "INDIVIDUAL|COMPANY|ORGANIZATION", "INDIVIDUAL")
  .option("--id-number <id>", "身份证 / 统一社会信用代码")
  .option("--phone <p>")
  .option("--token <token>", "登录态")
  .action((opts) =>
    run(async () =>
      createClient(buildDeps(), await resolveAuth(opts.token), {
        name: opts.name,
        type: opts.type,
        idNumber: opts.idNumber,
        phone: opts.phone,
      }),
    ),
  );

client
  .command("list")
  .option("--token <token>", "登录态")
  .action((opts) => run(async () => listClients(buildDeps(), await resolveAuth(opts.token))));

client
  .command("show")
  .requiredOption("--client-id <id>")
  .option("--token <token>", "登录态")
  .action((opts) =>
    run(async () => getClient(buildDeps(), await resolveAuth(opts.token), { clientId: opts.clientId })),
  );

client
  .command("add-contact")
  .requiredOption("--client-id <id>")
  .requiredOption("--name <name>")
  .option("--title <t>")
  .option("--phone <p>")
  .option("--token <token>", "登录态")
  .action((opts) =>
    run(async () =>
      addContact(buildDeps(), await resolveAuth(opts.token), {
        clientId: opts.clientId,
        name: opts.name,
        title: opts.title,
        phone: opts.phone,
      }),
    ),
  );

// ── matter ──────────────────────────────────────────────────────────────────
const matter = program.command("matter").description("案件 / 程序");

matter
  .command("list")
  .option("--token <token>", "登录态")
  .action((opts) => run(async () => listMatters(buildDeps(), await resolveAuth(opts.token))));

matter
  .command("show")
  .requiredOption("--matter-id <id>")
  .option("--token <token>", "登录态")
  .action((opts) =>
    run(async () => getMatter(buildDeps(), await resolveAuth(opts.token), { matterId: opts.matterId })),
  );

matter
  .command("add-procedure")
  .description("为案件新增程序（一审/二审/执行…）")
  .requiredOption("--matter-id <id>")
  .requiredOption("--type <type>", "程序类型，如 FIRST_INSTANCE")
  .option("--engagement <e>", "ENGAGED|INFORMATIONAL", "ENGAGED")
  .option("--case-number <no>", "案号")
  .option("--handling-agency <a>", "办理机关")
  .option("--token <token>", "登录态")
  .action((opts) =>
    run(async () =>
      addProcedure(buildDeps(), await resolveAuth(opts.token), {
        matterId: opts.matterId,
        type: opts.type,
        engagement: opts.engagement,
        caseNumber: opts.caseNumber,
        handlingAgency: opts.handlingAgency,
      }),
    ),
  );

// ── deadline ──────────────────────────────────────────────────────────────
const deadline = program.command("deadline").description("法定期限");

deadline
  .command("compute")
  .description("按事件推算法定期限（DOMAIN-SPEC §9.1）")
  .requiredOption("--procedure-id <id>")
  .requiredOption("--event <event>", "JUDGMENT_SERVED|RULING_SERVED|COMPLAINT_SERVED|JUDGMENT_EFFECTIVE|PERFORMANCE_DUE|ARBITRATION_AWARD_RECEIVED")
  .requiredOption("--event-date <date>", "事件日期 YYYY-MM-DD")
  .option("--token <token>", "登录态")
  .action((opts) =>
    run(async () =>
      applyDeadlineRules(buildDeps(), await resolveAuth(opts.token), {
        procedureId: opts.procedureId,
        event: opts.event,
        eventDate: opts.eventDate,
      }),
    ),
  );

deadline
  .command("list")
  .requiredOption("--matter-id <id>")
  .option("--token <token>", "登录态")
  .action((opts) =>
    run(async () => listMatterDeadlines(buildDeps(), await resolveAuth(opts.token), { matterId: opts.matterId })),
  );

deadline
  .command("complete")
  .requiredOption("--deadline-id <id>")
  .option("--token <token>", "登录态")
  .action((opts) =>
    run(async () => completeDeadline(buildDeps(), await resolveAuth(opts.token), { deadlineId: opts.deadlineId })),
  );

program
  .command("audit")
  .description("审计日志（仅 ADMIN）")
  .option("--action <a>", "按 action 过滤")
  .option("--limit <n>", "条数", "50")
  .option("--token <token>")
  .action((opts) =>
    run(async () =>
      listAudit(buildDeps(), await resolveAuth(opts.token), { action: opts.action, limit: Number(opts.limit) }),
    ),
  );

// ── archive ───────────────────────────────────────────────────────────────────
const archive = program.command("archive").description("归档");
archive
  .command("checklist")
  .requiredOption("--matter-id <id>")
  .option("--token <token>")
  .action((opts) => run(async () => getArchiveChecklist(buildDeps(), await resolveAuth(opts.token), { matterId: opts.matterId })));
archive
  .command("do")
  .description("归档案件（仅 ADMIN/PRINCIPAL_LAWYER）")
  .requiredOption("--matter-id <id>")
  .requiredOption("--summary <s>", "结案小结")
  .option("--checked <item...>", "已具备的必备项名称", [])
  .option("--force-reason <r>", "缺料强制归档理由")
  .option("--token <token>")
  .action((opts) =>
    run(async () => {
      const checklist: Record<string, boolean> = {};
      for (const item of opts.checked as string[]) checklist[item] = true;
      return archiveMatter(buildDeps(), await resolveAuth(opts.token), {
        matterId: opts.matterId,
        summary: opts.summary,
        checklist,
        forceReason: opts.forceReason,
      });
    }),
  );

// ── finance ───────────────────────────────────────────────────────────────────
const finance = program.command("finance").description("财务");
finance
  .command("set-plan")
  .description("设置分成方案：--plan userId:percent[:label] 可多次")
  .requiredOption("--matter-id <id>")
  .option("--plan <p...>", "如 user1:30:合伙人", [])
  .option("--token <token>")
  .action((opts) =>
    run(async () => {
      const plans = (opts.plan as string[]).map((s) => {
        const [userId, percent, label] = s.split(":");
        return { userId, percent, label };
      });
      return setCommissionPlan(buildDeps(), await resolveAuth(opts.token), { matterId: opts.matterId, plans });
    }),
  );
finance
  .command("add-entry")
  .requiredOption("--matter-id <id>")
  .requiredOption("--type <t>", "RECEIVABLE|RECEIVED|REFUND|COST")
  .requiredOption("--amount <a>")
  .option("--payer-or-payee <p>")
  .option("--token <token>")
  .action((opts) =>
    run(async () =>
      createFeeEntry(buildDeps(), await resolveAuth(opts.token), {
        matterId: opts.matterId,
        type: opts.type,
        amount: opts.amount,
        payerOrPayee: opts.payerOrPayee,
      }),
    ),
  );
finance
  .command("delete-entry")
  .requiredOption("--fee-entry-id <id>")
  .option("--token <token>")
  .action((opts) => run(async () => deleteFeeEntry(buildDeps(), await resolveAuth(opts.token), { feeEntryId: opts.feeEntryId })));
finance
  .command("show")
  .requiredOption("--matter-id <id>")
  .option("--token <token>")
  .action((opts) => run(async () => getMatterFinance(buildDeps(), await resolveAuth(opts.token), { matterId: opts.matterId })));

// ── task / note / hearing ─────────────────────────────────────────────────────
const task = program.command("task").description("任务");
task
  .command("add")
  .requiredOption("--matter-id <id>")
  .requiredOption("--title <t>")
  .option("--due-at <date>")
  .option("--token <token>")
  .action((opts) =>
    run(async () => addTask(buildDeps(), await resolveAuth(opts.token), { matterId: opts.matterId, title: opts.title, dueAt: opts.dueAt })),
  );
task
  .command("list")
  .requiredOption("--matter-id <id>")
  .option("--token <token>")
  .action((opts) => run(async () => listMatterTasks(buildDeps(), await resolveAuth(opts.token), { matterId: opts.matterId })));
task
  .command("complete")
  .requiredOption("--task-id <id>")
  .option("--token <token>")
  .action((opts) => run(async () => completeTask(buildDeps(), await resolveAuth(opts.token), { taskId: opts.taskId })));

const note = program.command("note").description("沟通记录");
note
  .command("add")
  .requiredOption("--matter-id <id>")
  .requiredOption("--content <c>")
  .option("--channel <ch>", "PHONE|WECHAT|EMAIL|MEETING|COURT|OTHER", "OTHER")
  .option("--with-whom <w>")
  .option("--token <token>")
  .action((opts) =>
    run(async () => addNote(buildDeps(), await resolveAuth(opts.token), { matterId: opts.matterId, content: opts.content, channel: opts.channel, withWhom: opts.withWhom })),
  );
note
  .command("list")
  .requiredOption("--matter-id <id>")
  .option("--token <token>")
  .action((opts) => run(async () => listMatterNotes(buildDeps(), await resolveAuth(opts.token), { matterId: opts.matterId })));

const hearing = program.command("hearing").description("开庭");
hearing
  .command("add")
  .requiredOption("--procedure-id <id>")
  .requiredOption("--title <t>")
  .requiredOption("--starts-at <datetime>", "如 2026-07-01T09:30")
  .option("--room <r>")
  .option("--judge <j>")
  .option("--token <token>")
  .action((opts) =>
    run(async () => addHearing(buildDeps(), await resolveAuth(opts.token), { procedureId: opts.procedureId, title: opts.title, startsAt: opts.startsAt, room: opts.room, judge: opts.judge })),
  );
hearing
  .command("list")
  .requiredOption("--matter-id <id>")
  .option("--token <token>")
  .action((opts) => run(async () => listMatterHearings(buildDeps(), await resolveAuth(opts.token), { matterId: opts.matterId })));

// ── preservation ────────────────────────────────────────────────────────────
const preservation = program.command("preservation").description("财产保全");

preservation
  .command("create")
  .requiredOption("--matter-id <id>")
  .requiredOption("--type <t>", "PRE_LITIGATION|IN_LITIGATION|ENFORCEMENT")
  .requiredOption("--property-type <t>", "BANK_DEPOSIT|REAL_ESTATE|VEHICLE|EQUITY|IP|OTHER")
  .requiredOption("--start-date <date>", "生效日 YYYY-MM-DD")
  .option("--amount <a>", "保全金额")
  .option("--respondent <r>", "被保全人")
  .option("--duration-days <n>", "保全期限天数（缺省按财产类型法定上限）")
  .option("--token <token>", "登录态")
  .action((opts) =>
    run(async () =>
      createPreservation(buildDeps(), await resolveAuth(opts.token), {
        matterId: opts.matterId,
        type: opts.type,
        propertyType: opts.propertyType,
        startDate: opts.startDate,
        amount: opts.amount,
        respondent: opts.respondent,
        durationDays: opts.durationDays,
      }),
    ),
  );

preservation
  .command("list")
  .requiredOption("--matter-id <id>")
  .option("--token <token>", "登录态")
  .action((opts) =>
    run(async () => listMatterPreservations(buildDeps(), await resolveAuth(opts.token), { matterId: opts.matterId })),
  );

preservation
  .command("renew")
  .requiredOption("--preservation-id <id>")
  .requiredOption("--new-expiry-date <date>", "新到期日 YYYY-MM-DD")
  .option("--note <n>")
  .option("--token <token>", "登录态")
  .action((opts) =>
    run(async () =>
      renewPreservation(buildDeps(), await resolveAuth(opts.token), {
        preservationId: opts.preservationId,
        newExpiryDate: opts.newExpiryDate,
        note: opts.note,
      }),
    ),
  );

preservation
  .command("scan")
  .description("系统任务：标记已过期保全（cron 入口，DOMAIN-SPEC §9.2）")
  .action(() => run(async () => scanPreservationExpiry(buildDeps())));

// ── folder (卷宗) ─────────────────────────────────────────────────────────────
const folder = program.command("folder").description("卷宗");
folder
  .command("list")
  .requiredOption("--matter-id <id>")
  .option("--token <token>")
  .action((opts) => run(async () => listFolders(buildDeps(), await resolveAuth(opts.token), { matterId: opts.matterId })));
folder
  .command("create")
  .requiredOption("--matter-id <id>")
  .requiredOption("--name <name>")
  .option("--token <token>")
  .action((opts) => run(async () => createFolder(buildDeps(), await resolveAuth(opts.token), { matterId: opts.matterId, name: opts.name })));
folder
  .command("rename")
  .requiredOption("--folder-id <id>")
  .requiredOption("--name <name>")
  .option("--token <token>")
  .action((opts) => run(async () => renameFolder(buildDeps(), await resolveAuth(opts.token), { folderId: opts.folderId, name: opts.name })));
folder
  .command("delete")
  .requiredOption("--folder-id <id>")
  .option("--token <token>")
  .action((opts) => run(async () => deleteFolder(buildDeps(), await resolveAuth(opts.token), { folderId: opts.folderId })));

// ── document (材料/文书) ───────────────────────────────────────────────────────
const document = program.command("document").description("材料 / 文书");
document
  .command("register")
  .requiredOption("--matter-id <id>")
  .requiredOption("--name <name>")
  .option("--category <c>", "EVIDENCE|PLEADING|PROCEDURE|JUDGMENT|CONTRACT|OTHER", "OTHER")
  .option("--folder-id <id>")
  .option("--source-party <p>")
  .option("--token <token>")
  .action((opts) =>
    run(async () =>
      registerDocument(buildDeps(), await resolveAuth(opts.token), {
        matterId: opts.matterId,
        name: opts.name,
        category: opts.category,
        folderId: opts.folderId,
        sourceParty: opts.sourceParty,
      }),
    ),
  );
document
  .command("list")
  .requiredOption("--matter-id <id>")
  .option("--token <token>")
  .action((opts) => run(async () => listDocuments(buildDeps(), await resolveAuth(opts.token), { matterId: opts.matterId })));
document
  .command("move")
  .requiredOption("--document-id <id>")
  .option("--folder-id <id>", "目标卷宗（省略=移出至案件根）")
  .option("--token <token>")
  .action((opts) => run(async () => moveDocument(buildDeps(), await resolveAuth(opts.token), { documentId: opts.documentId, folderId: opts.folderId ?? null })));
document
  .command("submit")
  .description("提交审核 DRAFT → PENDING_REVIEW")
  .requiredOption("--document-id <id>")
  .option("--token <token>")
  .action((opts) => run(async () => submitDocumentForReview(buildDeps(), await resolveAuth(opts.token), { documentId: opts.documentId })));
document
  .command("approve")
  .description("通过审核 PENDING_REVIEW → APPROVED（管理角色）")
  .requiredOption("--document-id <id>")
  .option("--token <token>")
  .action((opts) => run(async () => approveDocument(buildDeps(), await resolveAuth(opts.token), { documentId: opts.documentId })));
document
  .command("reject")
  .description("退回 PENDING_REVIEW → DRAFT（管理角色）")
  .requiredOption("--document-id <id>")
  .option("--reason <r>")
  .option("--token <token>")
  .action((opts) => run(async () => rejectDocument(buildDeps(), await resolveAuth(opts.token), { documentId: opts.documentId, reason: opts.reason })));
document
  .command("file")
  .description("入卷归档 APPROVED → FILED")
  .requiredOption("--document-id <id>")
  .option("--token <token>")
  .action((opts) => run(async () => fileDocument(buildDeps(), await resolveAuth(opts.token), { documentId: opts.documentId })));
document
  .command("delete")
  .requiredOption("--document-id <id>")
  .option("--token <token>")
  .action((opts) => run(async () => deleteDocument(buildDeps(), await resolveAuth(opts.token), { documentId: opts.documentId })));

program.parseAsync(process.argv);
