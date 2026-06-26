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
  addProcedure,
  applyDeadlineRules,
  completeDeadline,
  convertIntake,
  createIntake,
  createPreservation,
  declineIntake,
  getMatter,
  hashPassword,
  listMatterDeadlines,
  listMatterPreservations,
  listMatters,
  login,
  renewPreservation,
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
  return {
    db: createDb(url),
    ids: { newId: () => randomUUID() },
    clock: { now: () => new Date() },
    secrets: { jwt: secret },
  };
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

program.parseAsync(process.argv);
