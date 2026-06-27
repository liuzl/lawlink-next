#!/usr/bin/env node
/**
 * lawlink CLI — agent-native entry shell.
 *
 * A thin adapter over @lawlink/core. Each command runs in one of two modes:
 *  - LOCAL (default): assemble Deps over a local libSQL file + fs storage and
 *    call the core use case in-process.
 *  - REMOTE (`--remote [url]`, or env LAWLINK_REMOTE=1): issue an HTTP request to
 *    the deployed Worker's /api/* route with a Bearer token, so the CLI drives
 *    the SAME live instance the web app does.
 * Both modes share each command's input object; output is structured JSON.
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
  createSealRequest,
  approveSealRequest,
  rejectSealRequest,
  stampSealRequest,
  cancelSealRequest,
  listSealRequests,
  getSealRequest,
  listSealTypes,
  setSetting,
  listSettings,
  listUsers,
  getReport,
  getSchedule,
  getFinanceOverview,
  createInvoiceRequest,
  approveInvoice,
  rejectInvoice,
  issueInvoice,
  listInvoiceRequests,
  getInvoiceRequest,
  listNotifications,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  ingestSms,
  listSms,
  getSms,
  assignSmsMatter,
  generateHearingFromSms,
  generateDeadlineFromSms,
  markSmsProcessed,
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
  listMatterMembers,
  setMatterTeam,
  login,
  renewPreservation,
  scanPreservationExpiry,
  requireJwtSecret,
  runConflictCheck,
  verifyToken,
  uploadDocument,
  getDocumentForDownload,
  createTemplate,
  listTemplates,
  deleteTemplate,
  previewTemplate,
  generateFromTemplate,
  createFsStorage,
  DomainError,
  type AuthContext,
  type Deps,
  type Role,
} from "@lawlink/core";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { createDb, runMigrations, users } from "@lawlink/db";

/** Default deployed API base for --remote (override with a value or LAWLINK_API_URL). */
const DEFAULT_REMOTE = "https://lawlink-next.zhanliangliu.workers.dev";

/** Resolve the real JWT secret — throws if unset/placeholder (no fallback). */
function getSecret(): string {
  return requireJwtSecret(process.env.LAWLINK_JWT_SECRET);
}

/** Deps for LOCAL mode. `secret` is only needed by token-issuing use cases (login). */
function buildDeps(secret = ""): Deps {
  const url = process.env.LAWLINK_DB_URL ?? "file:./lawlink.db";
  const db = createDb(url);
  const ids = { newId: () => randomUUID() };
  const clock = { now: () => new Date() };
  const storage = createFsStorage(process.env.LAWLINK_STORAGE_DIR ?? "./storage");
  return { db, ids, clock, secrets: { jwt: secret }, audit: createAuditSink(db, ids, clock), storage };
}

/** Resolve the caller for LOCAL mode: a verified token if given, else an env stub (dev only). */
async function resolveAuth(token?: string): Promise<AuthContext> {
  if (token) return verifyToken(getSecret(), token);
  return {
    userId: process.env.LAWLINK_USER_ID ?? "cli-user",
    role: (process.env.LAWLINK_ROLE as Role) ?? "LAWYER",
  };
}

/** The bearer token for a command: --token wins, else env LAWLINK_TOKEN. */
function tokenOf(opts: { token?: string }): string | undefined {
  return opts.token ?? process.env.LAWLINK_TOKEN ?? undefined;
}

/** Remote API base if --remote (or LAWLINK_REMOTE) is set, else null (= local).
 * `--remote` is a boolean flag (a value-taking option would greedily swallow the
 * subcommand); override the base with `--api-url <url>` or LAWLINK_API_URL. */
function remoteBase(): string | null {
  const o = program.opts();
  if (!o.remote && !process.env.LAWLINK_REMOTE) return null;
  return (o.apiUrl as string | undefined) ?? process.env.LAWLINK_API_URL ?? DEFAULT_REMOTE;
}

/** Build a `?a=b&c=d` query string, skipping null/undefined/"" values. */
function q(params: Record<string, unknown>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** Stable machine-readable error code → HTTP status (mirrors the API). */
const HTTP: Record<string, number> = { VALIDATION: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID_STATE: 409, BAD_USAGE: 400, INTERNAL: 500 };
/** error code → process exit code, so agents can branch on the exit status alone. */
const EXIT: Record<string, number> = { VALIDATION: 2, BAD_USAGE: 2, FORBIDDEN: 3, NOT_FOUND: 4, CONFLICT: 5, INVALID_STATE: 5, INTERNAL: 1 };

interface NormErr {
  code: string;
  message: string;
  http?: number;
}

/** An HTTP error carrying the API's machine code + status (thrown by apiCall). */
class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly http: number) {
    super(message);
  }
}

/** Normalize ANY thrown value into { code, message, http } for the error envelope. */
function toError(err: unknown): NormErr {
  if (err instanceof ApiError) return { code: err.code, message: err.message, http: err.http };
  if (err instanceof DomainError) return { code: err.code, message: err.message, http: HTTP[err.code] };
  // Zod (local input validation) — match structurally to avoid a zod dep here.
  if (err && typeof err === "object" && (err as { name?: string }).name === "ZodError") {
    const issues = (err as { issues?: { message: string }[] }).issues ?? [];
    return { code: "VALIDATION", message: issues.map((i) => i.message).join("；") || "输入校验失败", http: 400 };
  }
  return { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) };
}

/** Issue an HTTP request to the deployed API; throw ApiError(code, http) on non-2xx. */
async function apiCall(method: string, path: string, body: unknown, token: string | undefined, base: string): Promise<unknown> {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; code?: string };
    throw new ApiError(d.error ?? `HTTP ${res.status}: ${text.slice(0, 200)}`, d.code ?? "INTERNAL", res.status);
  }
  return data;
}

/** True when --raw: print bare data on success / error to stderr (pipe-friendly). */
function rawMode(): boolean {
  return !!program.opts().raw;
}

/**
 * Run an action and emit a consistent, agent-parseable result:
 *  - default: a `{ "ok": true, "data": … }` / `{ "ok": false, "error": { code, message, http } }`
 *    envelope on STDOUT (single stream, one JSON.parse, check `.ok`);
 *  - `--raw`: bare data on stdout (success) / `{ "error": … }` on stderr (failure).
 * Exit code is 0 on success, else mapped from the error code (see EXIT).
 */
function run(fn: () => Promise<unknown>): void {
  Promise.resolve()
    .then(fn)
    .then((data) => {
      if (rawMode()) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
      else process.stdout.write(JSON.stringify({ ok: true, data }, null, 2) + "\n");
    })
    .catch((err) => {
      const e = toError(err);
      const line = JSON.stringify(rawMode() ? { error: e } : { ok: false, error: e }, null, 2) + "\n";
      (rawMode() ? process.stderr : process.stdout).write(line);
      process.exitCode = EXIT[e.code] ?? 1;
    });
}

interface Spec {
  method: "GET" | "POST" | "PUT";
  /** API path (with concrete params + query already substituted). */
  path: string;
  /** Request body (POST/PUT) AND the input passed to the local use case. */
  input?: Record<string, unknown>;
  /** Local in-process call: receives the resolved auth + the same input. The
   * input is `any` so it satisfies each use case's specific parameter type — the
   * core (and the API in remote mode) do the real zod validation. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  local: (auth: AuthContext, input: any) => Promise<unknown> | unknown;
}

/** Dispatch a command in remote (HTTP) or local (in-process) mode. */
function dispatch(opts: { token?: string }, spec: Spec): void {
  const base = remoteBase();
  run(async () => {
    const input = spec.input ?? {};
    if (base) return apiCall(spec.method, spec.path, spec.method === "GET" ? undefined : input, tokenOf(opts), base);
    return spec.local(await resolveAuth(tokenOf(opts)), input);
  });
}

const program = new Command();
program
  .name("lawlink")
  .description("LawLink CLI — case management for lawyers, built for humans and agents")
  .option("--remote", "call the deployed API instead of the local DB (or set LAWLINK_REMOTE=1)")
  .option("--api-url <url>", `API base for --remote (default ${DEFAULT_REMOTE}; or LAWLINK_API_URL)`)
  .option("--raw", "print bare data on stdout (errors to stderr) instead of the {ok,data} envelope")
  .version("0.0.0")
  // Route commander's own usage errors (unknown command / missing option) through
  // the SAME JSON envelope instead of plain text on stderr, so an agent never
  // gets non-JSON. exitOverride() makes commander throw; we catch below.
  .exitOverride()
  .configureOutput({ writeErr: () => {} });

// ── db (LOCAL only — operates on the libSQL file) ───────────────────────────
const db = program.command("db").description("数据库维护（仅本地 libSQL）");

db.command("migrate")
  .description("Apply pending migrations (local libSQL; run from source, not the bundled binary)")
  .action(() =>
    run(async () => {
      try {
        await runMigrations(buildDeps().db);
      } catch (e) {
        // The bundled binary can't resolve the Drizzle migrations folder (path is
        // relative to the @lawlink/db source). Local schema setup is a dev task.
        if (e instanceof Error && /undefined|migrations|ENOENT/i.test(e.message)) {
          throw new DomainError("INVALID_STATE", "本地建表请用源码方式：pnpm --filter @lawlink/cli dev db migrate（打包二进制不含迁移文件）");
        }
        throw e;
      }
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
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: "/api/auth/login",
      input: { email: opts.email, password: opts.password },
      local: (_auth, input) => login(buildDeps(getSecret()), input),
    }),
  );

// whoami is a LOCAL token-verify helper (no API route).
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
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: "/api/intakes",
      input: {
        title: opts.title,
        category: opts.category,
        clientName: opts.clientName,
        clientIdNumber: opts.clientIdNumber,
        opposingName: opts.opposingName,
        opposingIdNumber: opts.opposingIdNumber,
        claimAmount: opts.claimAmount,
      },
      local: (a, input) => createIntake(buildDeps(), a, input),
    }),
  );

intake
  .command("decline")
  .description("标记不接案（仅 ADMIN / PRINCIPAL_LAWYER）")
  .requiredOption("--intake-id <id>")
  .requiredOption("--reason <reason>")
  .requiredOption("--token <token>", "登录态")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/intakes/${opts.intakeId}/decline`,
      input: { intakeId: opts.intakeId, reason: opts.reason },
      local: (a, input) => declineIntake(buildDeps(), a, input),
    }),
  );

intake
  .command("convert")
  .description("转为正式案件（仅 ADMIN / PRINCIPAL_LAWYER）")
  .requiredOption("--intake-id <id>")
  .requiredOption("--token <token>", "登录态")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/intakes/${opts.intakeId}/convert`,
      input: { intakeId: opts.intakeId },
      local: (a, input) => convertIntake(buildDeps(), a, input),
    }),
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
    dispatch(opts, {
      method: "POST",
      path: "/api/conflicts/check",
      input: { name: opts.name, idNumber: opts.idNumber, candidateRole: opts.candidateRole, intakeId: opts.intakeId },
      local: (a, input) => runConflictCheck(buildDeps(), a, input),
    }),
  );

program
  .command("dashboard")
  .description("工作台聚合（近期到期等）")
  .option("--token <token>", "登录态")
  .action((opts) =>
    dispatch(opts, { method: "GET", path: "/api/dashboard", local: (a) => getDashboard(buildDeps(), a) }),
  );

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
    dispatch(opts, {
      method: "POST",
      path: "/api/clients",
      input: { name: opts.name, type: opts.type, idNumber: opts.idNumber, phone: opts.phone },
      local: (a, input) => createClient(buildDeps(), a, input),
    }),
  );

client
  .command("list")
  .option("--token <token>", "登录态")
  .action((opts) => dispatch(opts, { method: "GET", path: "/api/clients", local: (a) => listClients(buildDeps(), a) }));

client
  .command("show")
  .requiredOption("--client-id <id>")
  .option("--token <token>", "登录态")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/clients/${opts.clientId}`,
      input: { clientId: opts.clientId },
      local: (a, input) => getClient(buildDeps(), a, input),
    }),
  );

client
  .command("add-contact")
  .requiredOption("--client-id <id>")
  .requiredOption("--name <name>")
  .option("--title <t>")
  .option("--phone <p>")
  .option("--token <token>", "登录态")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/clients/${opts.clientId}/contacts`,
      input: { clientId: opts.clientId, name: opts.name, title: opts.title, phone: opts.phone },
      local: (a, input) => addContact(buildDeps(), a, input),
    }),
  );

// ── matter ──────────────────────────────────────────────────────────────────
const matter = program.command("matter").description("案件 / 程序");

matter
  .command("list")
  .option("--token <token>", "登录态")
  .action((opts) => dispatch(opts, { method: "GET", path: "/api/matters", local: (a) => listMatters(buildDeps(), a) }));

matter
  .command("show")
  .requiredOption("--matter-id <id>")
  .option("--token <token>", "登录态")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/matters/${opts.matterId}`,
      input: { matterId: opts.matterId },
      local: (a, input) => getMatter(buildDeps(), a, input),
    }),
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
    dispatch(opts, {
      method: "POST",
      path: `/api/matters/${opts.matterId}/procedures`,
      input: {
        matterId: opts.matterId,
        type: opts.type,
        engagement: opts.engagement,
        caseNumber: opts.caseNumber,
        handlingAgency: opts.handlingAgency,
      },
      local: (a, input) => addProcedure(buildDeps(), a, input),
    }),
  );

matter
  .command("members")
  .description("查看案件承办团队")
  .requiredOption("--matter-id <id>")
  .option("--token <token>", "登录态")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/matters/${opts.matterId}/members`,
      input: { matterId: opts.matterId },
      local: (a, input) => listMatterMembers(buildDeps(), a, input),
    }),
  );

matter
  .command("set-team")
  .description("设置案件承办团队（主办/协办/助理），整体替换")
  .requiredOption("--matter-id <id>")
  .requiredOption("--owner <userId>", "主办律师用户 ID")
  .option("--co-lead <ids>", "协办律师用户 ID，逗号分隔", "")
  .option("--assistant <ids>", "助理用户 ID，逗号分隔", "")
  .option("--token <token>", "登录态")
  .action((opts) =>
    dispatch(opts, {
      method: "PUT",
      path: `/api/matters/${opts.matterId}/team`,
      input: {
        matterId: opts.matterId,
        ownerId: opts.owner,
        coLeadIds: String(opts.coLead).split(",").map((s: string) => s.trim()).filter(Boolean),
        assistantIds: String(opts.assistant).split(",").map((s: string) => s.trim()).filter(Boolean),
      },
      local: (a, input) => setMatterTeam(buildDeps(), a, input),
    }),
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
    dispatch(opts, {
      method: "POST",
      path: `/api/procedures/${opts.procedureId}/deadlines/compute`,
      input: { procedureId: opts.procedureId, event: opts.event, eventDate: opts.eventDate },
      local: (a, input) => applyDeadlineRules(buildDeps(), a, input),
    }),
  );

deadline
  .command("list")
  .requiredOption("--matter-id <id>")
  .option("--token <token>", "登录态")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/matters/${opts.matterId}/deadlines`,
      input: { matterId: opts.matterId },
      local: (a, input) => listMatterDeadlines(buildDeps(), a, input),
    }),
  );

deadline
  .command("complete")
  .requiredOption("--deadline-id <id>")
  .option("--token <token>", "登录态")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/deadlines/${opts.deadlineId}/complete`,
      input: { deadlineId: opts.deadlineId },
      local: (a, input) => completeDeadline(buildDeps(), a, input),
    }),
  );

program
  .command("audit")
  .description("审计日志（仅 ADMIN）")
  .option("--action <a>", "按 action 过滤")
  .option("--limit <n>", "条数", "50")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/audit${q({ action: opts.action, limit: opts.limit })}`,
      input: { action: opts.action, limit: Number(opts.limit) },
      local: (a, input) => listAudit(buildDeps(), a, input),
    }),
  );

// ── archive ───────────────────────────────────────────────────────────────────
const archive = program.command("archive").description("归档");
archive
  .command("checklist")
  .requiredOption("--matter-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/matters/${opts.matterId}/archive-checklist`,
      input: { matterId: opts.matterId },
      local: (a, input) => getArchiveChecklist(buildDeps(), a, input),
    }),
  );
archive
  .command("do")
  .description("归档案件（仅 ADMIN/PRINCIPAL_LAWYER）")
  .requiredOption("--matter-id <id>")
  .requiredOption("--summary <s>", "结案小结")
  .option("--checked <item...>", "已具备的必备项名称", [])
  .option("--force-reason <r>", "缺料强制归档理由")
  .option("--token <token>")
  .action((opts) => {
    const checklist: Record<string, boolean> = {};
    for (const item of opts.checked as string[]) checklist[item] = true;
    dispatch(opts, {
      method: "POST",
      path: `/api/matters/${opts.matterId}/archive`,
      input: { matterId: opts.matterId, summary: opts.summary, checklist, forceReason: opts.forceReason },
      local: (a, input) => archiveMatter(buildDeps(), a, input),
    });
  });

// ── finance ───────────────────────────────────────────────────────────────────
const finance = program.command("finance").description("财务");
finance
  .command("overview")
  .description("全所财务台账（ADMIN / 主任 / 财务）")
  .option("--months <n>", "近 N 月", "6")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/finance/overview${q({ months: opts.months })}`,
      input: { months: opts.months },
      local: (a, input) => getFinanceOverview(buildDeps(), a, input),
    }),
  );
finance
  .command("set-plan")
  .description("设置分成方案：--plan userId:percent[:label] 可多次")
  .requiredOption("--matter-id <id>")
  .option("--plan <p...>", "如 user1:30:合伙人", [])
  .option("--token <token>")
  .action((opts) => {
    const plans = (opts.plan as string[]).map((s) => {
      const [userId, percent, label] = s.split(":");
      return { userId, percent, label };
    });
    dispatch(opts, {
      method: "POST",
      path: `/api/matters/${opts.matterId}/commission-plan`,
      input: { matterId: opts.matterId, plans },
      local: (a, input) => setCommissionPlan(buildDeps(), a, input),
    });
  });
finance
  .command("add-entry")
  .requiredOption("--matter-id <id>")
  .requiredOption("--type <t>", "RECEIVABLE|RECEIVED|REFUND|COST")
  .requiredOption("--amount <a>")
  .option("--payer-or-payee <p>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/matters/${opts.matterId}/fee-entries`,
      input: { matterId: opts.matterId, type: opts.type, amount: opts.amount, payerOrPayee: opts.payerOrPayee },
      local: (a, input) => createFeeEntry(buildDeps(), a, input),
    }),
  );
finance
  .command("delete-entry")
  .requiredOption("--fee-entry-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/fee-entries/${opts.feeEntryId}/delete`,
      input: { feeEntryId: opts.feeEntryId },
      local: (a, input) => deleteFeeEntry(buildDeps(), a, input),
    }),
  );
finance
  .command("show")
  .requiredOption("--matter-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/matters/${opts.matterId}/finance`,
      input: { matterId: opts.matterId },
      local: (a, input) => getMatterFinance(buildDeps(), a, input),
    }),
  );

// ── task / note / hearing ─────────────────────────────────────────────────────
const task = program.command("task").description("任务");
task
  .command("add")
  .requiredOption("--matter-id <id>")
  .requiredOption("--title <t>")
  .option("--due-at <date>")
  .option("--assignee-id <id>", "指派给（用户 ID）")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/matters/${opts.matterId}/tasks`,
      input: { matterId: opts.matterId, title: opts.title, dueAt: opts.dueAt, assigneeId: opts.assigneeId },
      local: (a, input) => addTask(buildDeps(), a, input),
    }),
  );
task
  .command("list")
  .requiredOption("--matter-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/matters/${opts.matterId}/tasks`,
      input: { matterId: opts.matterId },
      local: (a, input) => listMatterTasks(buildDeps(), a, input),
    }),
  );
task
  .command("complete")
  .requiredOption("--task-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/tasks/${opts.taskId}/complete`,
      input: { taskId: opts.taskId },
      local: (a, input) => completeTask(buildDeps(), a, input),
    }),
  );

const note = program.command("note").description("沟通记录");
note
  .command("add")
  .requiredOption("--matter-id <id>")
  .requiredOption("--content <c>")
  .option("--channel <ch>", "PHONE|WECHAT|EMAIL|MEETING|COURT|OTHER", "OTHER")
  .option("--with-whom <w>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/matters/${opts.matterId}/notes`,
      input: { matterId: opts.matterId, content: opts.content, channel: opts.channel, withWhom: opts.withWhom },
      local: (a, input) => addNote(buildDeps(), a, input),
    }),
  );
note
  .command("list")
  .requiredOption("--matter-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/matters/${opts.matterId}/notes`,
      input: { matterId: opts.matterId },
      local: (a, input) => listMatterNotes(buildDeps(), a, input),
    }),
  );

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
    dispatch(opts, {
      method: "POST",
      path: `/api/procedures/${opts.procedureId}/hearings`,
      input: { procedureId: opts.procedureId, title: opts.title, startsAt: opts.startsAt, room: opts.room, judge: opts.judge },
      local: (a, input) => addHearing(buildDeps(), a, input),
    }),
  );
hearing
  .command("list")
  .requiredOption("--matter-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/matters/${opts.matterId}/hearings`,
      input: { matterId: opts.matterId },
      local: (a, input) => listMatterHearings(buildDeps(), a, input),
    }),
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
    dispatch(opts, {
      method: "POST",
      path: `/api/matters/${opts.matterId}/preservations`,
      input: {
        matterId: opts.matterId,
        type: opts.type,
        propertyType: opts.propertyType,
        startDate: opts.startDate,
        amount: opts.amount,
        respondent: opts.respondent,
        durationDays: opts.durationDays,
      },
      local: (a, input) => createPreservation(buildDeps(), a, input),
    }),
  );

preservation
  .command("list")
  .requiredOption("--matter-id <id>")
  .option("--token <token>", "登录态")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/matters/${opts.matterId}/preservations`,
      input: { matterId: opts.matterId },
      local: (a, input) => listMatterPreservations(buildDeps(), a, input),
    }),
  );

preservation
  .command("renew")
  .requiredOption("--preservation-id <id>")
  .requiredOption("--new-expiry-date <date>", "新到期日 YYYY-MM-DD")
  .option("--note <n>")
  .option("--token <token>", "登录态")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/preservations/${opts.preservationId}/renew`,
      input: { preservationId: opts.preservationId, newExpiryDate: opts.newExpiryDate, note: opts.note },
      local: (a, input) => renewPreservation(buildDeps(), a, input),
    }),
  );

preservation
  .command("scan")
  .description("系统任务：标记已过期保全（本地 cron 入口，DOMAIN-SPEC §9.2）")
  .action(() => run(async () => scanPreservationExpiry(buildDeps())));

// ── folder (卷宗) ─────────────────────────────────────────────────────────────
const folder = program.command("folder").description("卷宗");
folder
  .command("list")
  .requiredOption("--matter-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/matters/${opts.matterId}/folders`,
      input: { matterId: opts.matterId },
      local: (a, input) => listFolders(buildDeps(), a, input),
    }),
  );
folder
  .command("create")
  .requiredOption("--matter-id <id>")
  .requiredOption("--name <name>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/matters/${opts.matterId}/folders`,
      input: { matterId: opts.matterId, name: opts.name },
      local: (a, input) => createFolder(buildDeps(), a, input),
    }),
  );
folder
  .command("rename")
  .requiredOption("--folder-id <id>")
  .requiredOption("--name <name>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/folders/${opts.folderId}/rename`,
      input: { folderId: opts.folderId, name: opts.name },
      local: (a, input) => renameFolder(buildDeps(), a, input),
    }),
  );
folder
  .command("delete")
  .requiredOption("--folder-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/folders/${opts.folderId}/delete`,
      input: { folderId: opts.folderId },
      local: (a, input) => deleteFolder(buildDeps(), a, input),
    }),
  );

// ── document (材料/文书) ───────────────────────────────────────────────────────
const document = program.command("document").description("材料 / 文书");
document
  .command("upload")
  .description("上传真实文件并登记材料")
  .requiredOption("--matter-id <id>")
  .requiredOption("--file <path>", "本地文件路径")
  .option("--name <name>", "材料名（缺省取文件名）")
  .option("--category <c>", "EVIDENCE|PLEADING|PROCEDURE|JUDGMENT|CONTRACT|OTHER", "OTHER")
  .option("--folder-id <id>")
  .option("--token <token>")
  .action((opts) =>
    run(async () => {
      const buf = await readFile(opts.file);
      const name = opts.name ?? basename(opts.file);
      const base = remoteBase();
      if (base) {
        const form = new FormData();
        form.set("file", new Blob([buf]), name);
        form.set("name", name);
        if (opts.category) form.set("category", opts.category);
        if (opts.folderId) form.set("folderId", opts.folderId);
        const token = tokenOf(opts);
        const res = await fetch(`${base}/api/matters/${opts.matterId}/documents/upload`, {
          method: "POST",
          headers: token ? { authorization: `Bearer ${token}` } : {},
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
        return data;
      }
      return uploadDocument(
        buildDeps(),
        await resolveAuth(tokenOf(opts)),
        { matterId: opts.matterId, name, category: opts.category, folderId: opts.folderId },
        new Uint8Array(buf),
      );
    }),
  );
document
  .command("download")
  .requiredOption("--id <id>")
  .requiredOption("--out <path>", "保存到本地路径")
  .option("--token <token>")
  .action((opts) =>
    run(async () => {
      const base = remoteBase();
      if (base) {
        const token = tokenOf(opts);
        const res = await fetch(`${base}/api/documents/${opts.id}/download`, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        await writeFile(opts.out, bytes);
        return { saved: opts.out, size: bytes.length };
      }
      const { name, bytes } = await getDocumentForDownload(buildDeps(), await resolveAuth(tokenOf(opts)), { documentId: opts.id });
      await writeFile(opts.out, bytes);
      return { saved: opts.out, name, size: bytes.length };
    }),
  );
document
  .command("register")
  .requiredOption("--matter-id <id>")
  .requiredOption("--name <name>")
  .option("--category <c>", "EVIDENCE|PLEADING|PROCEDURE|JUDGMENT|CONTRACT|OTHER", "OTHER")
  .option("--folder-id <id>")
  .option("--source-party <p>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/matters/${opts.matterId}/documents`,
      input: { matterId: opts.matterId, name: opts.name, category: opts.category, folderId: opts.folderId, sourceParty: opts.sourceParty },
      local: (a, input) => registerDocument(buildDeps(), a, input),
    }),
  );
document
  .command("list")
  .requiredOption("--matter-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/matters/${opts.matterId}/documents`,
      input: { matterId: opts.matterId },
      local: (a, input) => listDocuments(buildDeps(), a, input),
    }),
  );
document
  .command("move")
  .requiredOption("--document-id <id>")
  .option("--folder-id <id>", "目标卷宗（省略=移出至案件根）")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/documents/${opts.documentId}/move`,
      input: { documentId: opts.documentId, folderId: opts.folderId ?? null },
      local: (a, input) => moveDocument(buildDeps(), a, input),
    }),
  );
document
  .command("submit")
  .description("提交审核 DRAFT → PENDING_REVIEW")
  .requiredOption("--document-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/documents/${opts.documentId}/submit`,
      input: { documentId: opts.documentId },
      local: (a, input) => submitDocumentForReview(buildDeps(), a, input),
    }),
  );
document
  .command("approve")
  .description("通过审核 PENDING_REVIEW → APPROVED（管理角色）")
  .requiredOption("--document-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/documents/${opts.documentId}/approve`,
      input: { documentId: opts.documentId },
      local: (a, input) => approveDocument(buildDeps(), a, input),
    }),
  );
document
  .command("reject")
  .description("退回 PENDING_REVIEW → DRAFT（管理角色）")
  .requiredOption("--document-id <id>")
  .option("--reason <r>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/documents/${opts.documentId}/reject`,
      input: { documentId: opts.documentId, reason: opts.reason },
      local: (a, input) => rejectDocument(buildDeps(), a, input),
    }),
  );
document
  .command("file")
  .description("入卷归档 APPROVED → FILED")
  .requiredOption("--document-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/documents/${opts.documentId}/file`,
      input: { documentId: opts.documentId },
      local: (a, input) => fileDocument(buildDeps(), a, input),
    }),
  );
document
  .command("delete")
  .requiredOption("--document-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/documents/${opts.documentId}/delete`,
      input: { documentId: opts.documentId },
      local: (a, input) => deleteDocument(buildDeps(), a, input),
    }),
  );

// ── settings (设置) ───────────────────────────────────────────────────────────
const settings = program.command("settings").description("系统设置（ADMIN）");
settings
  .command("list")
  .option("--token <token>")
  .action((opts) => dispatch(opts, { method: "GET", path: "/api/settings", local: (a) => listSettings(buildDeps(), a) }));
settings
  .command("set")
  .requiredOption("--key <k>")
  .requiredOption("--value <v>", "JSON 值；字符串可直接给")
  .option("--token <token>")
  .action((opts) => {
    let value: unknown = opts.value;
    try {
      value = JSON.parse(opts.value);
    } catch {
      /* keep as raw string */
    }
    dispatch(opts, {
      method: "POST",
      path: "/api/settings",
      input: { key: opts.key, value },
      local: (a, input) => setSetting(buildDeps(), a, input),
    });
  });

// ── notification (通知中心) ────────────────────────────────────────────────────
const notify = program.command("notification").description("通知中心");
notify
  .command("list")
  .option("--unread")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/notifications${q({ unread: opts.unread ? 1 : undefined })}`,
      input: { unreadOnly: !!opts.unread },
      local: (a, input) => listNotifications(buildDeps(), a, input),
    }),
  );
notify
  .command("unread-count")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, { method: "GET", path: "/api/notifications/unread-count", local: (a) => unreadNotificationCount(buildDeps(), a) }),
  );
notify
  .command("read")
  .requiredOption("--id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/notifications/${opts.id}/read`,
      input: { notificationId: opts.id },
      local: (a, input) => markNotificationRead(buildDeps(), a, input),
    }),
  );
notify
  .command("read-all")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, { method: "POST", path: "/api/notifications/read-all", input: {}, local: (a) => markAllNotificationsRead(buildDeps(), a) }),
  );

// ── template (文书模板) ────────────────────────────────────────────────────────
const template = program.command("template").description("文书模板");
template
  .command("upload")
  .description("上传 .docx 模板（自动识别变量）")
  .requiredOption("--file <path>", "本地 .docx 路径")
  .requiredOption("--name <name>")
  .requiredOption("--category <c>", "INTAKE|RETAINER|LITIGATION|HEARING|WORK_PRODUCT|ARCHIVE|CLOSING|BLANK")
  .option("--description <d>")
  .option("--applicable <c...>", "适用案件类别（缺省=全部）", [])
  .option("--token <token>")
  .action((opts) =>
    run(async () => {
      const buf = await readFile(opts.file);
      const applicable = (opts.applicable as string[]).length ? (opts.applicable as string[]) : undefined;
      const base = remoteBase();
      if (base) {
        const form = new FormData();
        form.set("file", new Blob([buf]), opts.name);
        form.set("name", opts.name);
        form.set("category", opts.category);
        if (opts.description) form.set("description", opts.description);
        if (applicable) form.set("applicableCategories", JSON.stringify(applicable));
        const token = tokenOf(opts);
        const res = await fetch(`${base}/api/templates/upload`, {
          method: "POST",
          headers: token ? { authorization: `Bearer ${token}` } : {},
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
        return data;
      }
      return createTemplate(
        buildDeps(),
        await resolveAuth(tokenOf(opts)),
        { name: opts.name, category: opts.category, description: opts.description, applicableCategories: applicable },
        new Uint8Array(buf),
      );
    }),
  );
template
  .command("list")
  .option("--matter-category <c>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/templates${q({ matterCategory: opts.matterCategory })}`,
      input: { matterCategory: opts.matterCategory },
      local: (a, input) => listTemplates(buildDeps(), a, input),
    }),
  );
template
  .command("preview")
  .description("查看模板变量与本案缺失项")
  .requiredOption("--template-id <id>")
  .requiredOption("--matter-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/templates/${opts.templateId}/preview${q({ matterId: opts.matterId })}`,
      input: { templateId: opts.templateId, matterId: opts.matterId },
      local: (a, input) => previewTemplate(buildDeps(), a, input),
    }),
  );
template
  .command("generate")
  .description("套用模板生成文书（入卷）")
  .requiredOption("--template-id <id>")
  .requiredOption("--matter-id <id>")
  .option("--folder-id <id>")
  .option("--name <name>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/templates/${opts.templateId}/generate`,
      input: { templateId: opts.templateId, matterId: opts.matterId, folderId: opts.folderId, name: opts.name },
      local: (a, input) => generateFromTemplate(buildDeps(), a, input),
    }),
  );
template
  .command("delete")
  .requiredOption("--id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/templates/${opts.id}/delete`,
      input: { templateId: opts.id },
      local: (a, input) => deleteTemplate(buildDeps(), a, input),
    }),
  );

// ── invoice (开票) ─────────────────────────────────────────────────────────────
const invoice = program.command("invoice").description("开票工作流");
invoice
  .command("create")
  .requiredOption("--amount <a>")
  .requiredOption("--evidence-doc-id <id...>", "开票依据 Document id（可多个，必传）", [])
  .option("--matter-id <id>")
  .option("--matterless-reason <r>", "无关联案件原因（无 matter 时必填）")
  .option("--invoice-type <t>", "PLAIN|SPECIAL")
  .option("--invoice-item <t>", "LAWYER_FEE|CONSULTING_FEE|AGENCY_FEE|OTHER")
  .option("--buyer-name <n>")
  .option("--buyer-tax-no <n>")
  .option("--buyer-address <a>")
  .option("--buyer-phone <p>")
  .option("--buyer-bank <b>")
  .option("--buyer-bank-account <a>")
  .option("--request-note <n>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: "/api/invoices",
      input: {
        amount: opts.amount,
        evidenceDocIds: opts.evidenceDocId,
        matterId: opts.matterId,
        noMatterReason: opts.matterlessReason,
        invoiceType: opts.invoiceType,
        invoiceItem: opts.invoiceItem,
        buyerName: opts.buyerName,
        buyerTaxNo: opts.buyerTaxNo,
        buyerAddress: opts.buyerAddress,
        buyerPhone: opts.buyerPhone,
        buyerBank: opts.buyerBank,
        buyerBankAccount: opts.buyerBankAccount,
        requestNote: opts.requestNote,
      },
      local: (a, input) => createInvoiceRequest(buildDeps(), a, input),
    }),
  );
invoice
  .command("list")
  .option("--status <s>", "PENDING|APPROVED|ISSUED|REJECTED")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/invoices${q({ status: opts.status })}`,
      input: { status: opts.status },
      local: (a, input) => listInvoiceRequests(buildDeps(), a, input),
    }),
  );
invoice
  .command("show")
  .requiredOption("--id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/invoices/${opts.id}`,
      input: { invoiceRequestId: opts.id },
      local: (a, input) => getInvoiceRequest(buildDeps(), a, input),
    }),
  );
invoice
  .command("approve")
  .requiredOption("--id <id>")
  .option("--note <n>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/invoices/${opts.id}/approve`,
      input: { invoiceRequestId: opts.id, processNote: opts.note },
      local: (a, input) => approveInvoice(buildDeps(), a, input),
    }),
  );
invoice
  .command("reject")
  .requiredOption("--id <id>")
  .option("--note <n>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/invoices/${opts.id}/reject`,
      input: { invoiceRequestId: opts.id, processNote: opts.note },
      local: (a, input) => rejectInvoice(buildDeps(), a, input),
    }),
  );
invoice
  .command("issue")
  .description("开具：回填发票号 + 上传电子发票 APPROVED → ISSUED")
  .requiredOption("--id <id>")
  .requiredOption("--invoice-no <n>")
  .requiredOption("--invoice-file-id <id>", "电子发票 Document id")
  .option("--contract-scan-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/invoices/${opts.id}/issue`,
      input: { invoiceRequestId: opts.id, invoiceNo: opts.invoiceNo, invoiceFileId: opts.invoiceFileId, contractScanId: opts.contractScanId },
      local: (a, input) => issueInvoice(buildDeps(), a, input),
    }),
  );

// ── schedule (日程) ────────────────────────────────────────────────────────────
program
  .command("schedule")
  .description("日程：开庭 / 期限 / 保全到期 / 任务")
  .option("--from <date>", "起 YYYY-MM-DD")
  .option("--to <date>", "止 YYYY-MM-DD")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/schedule${q({ from: opts.from, to: opts.to })}`,
      input: { from: opts.from, to: opts.to },
      local: (a, input) => getSchedule(buildDeps(), a, input),
    }),
  );

// ── report (报表) ──────────────────────────────────────────────────────────────
program
  .command("report")
  .description("报表统计（ADMIN / 主任）")
  .option("--preset <p>", "month|quarter|year|lastYear", "month")
  .option("--start <date>", "自定义区间起 YYYY-MM-DD")
  .option("--end <date>", "自定义区间止 YYYY-MM-DD")
  .option("--token <token>")
  .action((opts) => {
    const preset = opts.start && opts.end ? undefined : opts.preset;
    dispatch(opts, {
      method: "GET",
      path: `/api/reports${q({ preset, start: opts.start, end: opts.end })}`,
      input: { preset, start: opts.start, end: opts.end },
      local: (a, input) => getReport(buildDeps(), a, input),
    });
  });

// ── user (用户目录) ────────────────────────────────────────────────────────────
const user = program.command("user").description("用户目录（ADMIN）");
user
  .command("list")
  .option("--active-only")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/users${q({ activeOnly: opts.activeOnly ? 1 : undefined })}`,
      input: { activeOnly: !!opts.activeOnly },
      local: (a, input) => listUsers(buildDeps(), a, input),
    }),
  );

// ── seal (用印审批) ────────────────────────────────────────────────────────────
const seal = program.command("seal").description("用印审批");
seal
  .command("types")
  .description("章种类目录")
  .option("--token <token>")
  .action((opts) => dispatch(opts, { method: "GET", path: "/api/seals/types", local: () => listSealTypes() }));
seal
  .command("create")
  .requiredOption("--seal-type <t>", "OFFICIAL_SEAL|CONTRACT_SEAL|CONTRACT_REVIEW_SEAL|FINANCE_SEAL|LEGAL_REP_SEAL")
  .requiredOption("--purpose <p>", "用章事由")
  .requiredOption("--document-title <t>", "待盖章文件标题")
  .requiredOption("--draft-doc-id <id>", "待盖章稿（Document id）")
  .option("--matter-id <id>")
  .option("--page-count <n>")
  .option("--copies <n>")
  .option("--urgency <u>", "NORMAL|URGENT", "NORMAL")
  .option("--require-cross-page-seal")
  .option("--request-note <n>")
  .option("--parent-seal-request-id <id>", "重新提交被驳回申请时引用原 ID")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: "/api/seals",
      input: {
        sealType: opts.sealType,
        purpose: opts.purpose,
        documentTitle: opts.documentTitle,
        draftDocId: opts.draftDocId,
        matterId: opts.matterId,
        pageCount: opts.pageCount,
        copies: opts.copies,
        urgency: opts.urgency,
        requireCrossPageSeal: opts.requireCrossPageSeal ?? false,
        requestNote: opts.requestNote,
        parentSealRequestId: opts.parentSealRequestId,
      },
      local: (a, input) => createSealRequest(buildDeps(), a, input),
    }),
  );
seal
  .command("list")
  .option("--status <s>", "PENDING|APPROVED|STAMPED|REJECTED|CANCELLED")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/seals${q({ status: opts.status })}`,
      input: { status: opts.status },
      local: (a, input) => listSealRequests(buildDeps(), a, input),
    }),
  );
seal
  .command("show")
  .requiredOption("--id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/seals/${opts.id}`,
      input: { sealRequestId: opts.id },
      local: (a, input) => getSealRequest(buildDeps(), a, input),
    }),
  );
seal
  .command("approve")
  .requiredOption("--id <id>")
  .option("--note <n>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/seals/${opts.id}/approve`,
      input: { sealRequestId: opts.id, approveNote: opts.note },
      local: (a, input) => approveSealRequest(buildDeps(), a, input),
    }),
  );
seal
  .command("reject")
  .requiredOption("--id <id>")
  .option("--note <n>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/seals/${opts.id}/reject`,
      input: { sealRequestId: opts.id, approveNote: opts.note },
      local: (a, input) => rejectSealRequest(buildDeps(), a, input),
    }),
  );
seal
  .command("stamp")
  .description("登记盖章并回填扫描件 APPROVED → STAMPED")
  .requiredOption("--id <id>")
  .requiredOption("--stamped-doc-id <id>", "盖章后扫描件（Document id）")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/seals/${opts.id}/stamp`,
      input: { sealRequestId: opts.id, stampedDocId: opts.stampedDocId },
      local: (a, input) => stampSealRequest(buildDeps(), a, input),
    }),
  );
seal
  .command("cancel")
  .requiredOption("--id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/seals/${opts.id}/cancel`,
      input: { sealRequestId: opts.id },
      local: (a, input) => cancelSealRequest(buildDeps(), a, input),
    }),
  );

// ── sms (法院短信解析) ─────────────────────────────────────────────────────────
const sms = program.command("sms").description("法院短信解析");
sms
  .command("ingest")
  .description("解析并入库一条短信（自动按案号匹配案件）")
  .requiredOption("--raw-text <t>", "短信原文")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: "/api/sms",
      input: { rawText: opts.rawText },
      local: (a, input) => ingestSms(buildDeps(), a, input),
    }),
  );
sms
  .command("list")
  .option("--processed", "仅看已处理")
  .option("--unprocessed", "仅看未处理")
  .option("--token <token>")
  .action((opts) => {
    const processed = opts.processed ? true : opts.unprocessed ? false : undefined;
    dispatch(opts, {
      method: "GET",
      path: `/api/sms${q({ processed })}`,
      input: { processed },
      local: (a, input) => listSms(buildDeps(), a, input),
    });
  });
sms
  .command("show")
  .requiredOption("--id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "GET",
      path: `/api/sms/${opts.id}`,
      input: { smsId: opts.id },
      local: (a, input) => getSms(buildDeps(), a, input),
    }),
  );
sms
  .command("assign")
  .description("手动匹配案件")
  .requiredOption("--id <id>")
  .requiredOption("--matter-id <id>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/sms/${opts.id}/assign`,
      input: { smsId: opts.id, matterId: opts.matterId },
      local: (a, input) => assignSmsMatter(buildDeps(), a, input),
    }),
  );
sms
  .command("gen-hearing")
  .description("一键生成开庭")
  .requiredOption("--id <id>")
  .option("--procedure-id <id>")
  .option("--title <t>")
  .option("--starts-at <datetime>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/sms/${opts.id}/gen-hearing`,
      input: { smsId: opts.id, procedureId: opts.procedureId, title: opts.title, startsAt: opts.startsAt },
      local: (a, input) => generateHearingFromSms(buildDeps(), a, input),
    }),
  );
sms
  .command("gen-deadline")
  .description("一键生成期限")
  .requiredOption("--id <id>")
  .option("--procedure-id <id>")
  .option("--title <t>")
  .option("--due-at <date>")
  .option("--category <c>")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/sms/${opts.id}/gen-deadline`,
      input: { smsId: opts.id, procedureId: opts.procedureId, title: opts.title, dueAt: opts.dueAt, category: opts.category },
      local: (a, input) => generateDeadlineFromSms(buildDeps(), a, input),
    }),
  );
sms
  .command("processed")
  .requiredOption("--id <id>")
  .option("--undo", "标记为未处理")
  .option("--token <token>")
  .action((opts) =>
    dispatch(opts, {
      method: "POST",
      path: `/api/sms/${opts.id}/processed`,
      input: { smsId: opts.id, processed: !opts.undo },
      local: (a, input) => markSmsProcessed(buildDeps(), a, input),
    }),
  );

// ── meta (agent capability discovery) ──────────────────────────────────────
/** Recursively describe a command tree (commander introspection) as JSON. */
function describe(cmd: Command): unknown {
  return {
    name: cmd.name(),
    description: cmd.description() || undefined,
    options: cmd.options
      .filter((o) => o.long !== "--help" && o.long !== "--version")
      .map((o) => ({ flags: o.flags, description: o.description || undefined, required: o.required ?? false, default: o.defaultValue })),
    commands: cmd.commands.filter((c) => c.name() !== "meta" && c.name() !== "help").map(describe),
  };
}

program
  .command("meta")
  .description("机器可读的能力清单（agent 调用前自描述：命令树 / 信封 / 退出码 / 认证）")
  .action(() =>
    run(async () => ({
      cli: "lawlink",
      version: "0.0.0",
      output: {
        default: 'envelope: success {"ok":true,"data":…} | error {"ok":false,"error":{code,message,http}} on stdout',
        raw: "--raw → bare data on stdout (success), {error} on stderr (failure)",
      },
      errorCodes: Object.keys(HTTP),
      exitCodes: { success: 0, ...EXIT },
      auth: "get a token via `auth login`; pass it with --token or env LAWLINK_TOKEN. Without it, local mode uses an env-stub identity (LAWLINK_USER_ID/LAWLINK_ROLE).",
      remote: `add --remote (or LAWLINK_REMOTE=1) to call the deployed API instead of local libSQL; --api-url or LAWLINK_API_URL overrides the base (default ${DEFAULT_REMOTE}).`,
      commands: (describe(program) as { commands: unknown[] }).commands,
    })),
  );

program.parseAsync(process.argv).catch((err: unknown) => {
  // commander throws on help/version (exitCode 0 — already printed) and on usage
  // errors (unknown command, missing/invalid option). Surface usage errors as the
  // JSON error envelope; let help/version exit cleanly.
  const ce = err as { exitCode?: number; code?: string; message?: string };
  if (ce && ce.exitCode === 0) process.exit(0);
  const e: NormErr = { code: "BAD_USAGE", message: (ce?.message ?? String(err)).replace(/^error:\s*/i, "").trim(), http: 400 };
  const line = JSON.stringify(rawMode() ? { error: e } : { ok: false, error: e }, null, 2) + "\n";
  (rawMode() ? process.stderr : process.stdout).write(line);
  process.exit(EXIT.BAD_USAGE);
});
