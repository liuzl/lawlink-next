/**
 * Hono HTTP API — Workers-native entry shell.
 *
 * Thin adapter over @lawlink/core: assemble Deps + AuthContext from the request
 * and delegate to a use case. No business logic here. P5 swaps the local libSQL
 * db for the D1 binding (`createD1Db(c.env.DB)`).
 */
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context, Next } from "hono";
import {
  addContact,
  addHearing,
  addNote,
  archiveMatter,
  createAuditSink,
  getArchiveChecklist,
  listAudit,
  addProcedure,
  addTask,
  applyDeadlineRules,
  completeDeadline,
  completeTask,
  listMatterHearings,
  listMatterNotes,
  listMatterTasks,
  convertIntake,
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
  ingestSms,
  listSms,
  getSms,
  assignSmsMatter,
  generateHearingFromSms,
  generateDeadlineFromSms,
  markSmsProcessed,
  declineIntake,
  deleteFeeEntry,
  getMatterFinance,
  setCommissionPlan,
  getClient,
  getDashboard,
  getMatter,
  listClients,
  liftPreservation,
  listIntakes,
  listMatterDeadlines,
  listMatterPreservations,
  listMatters,
  login,
  renewPreservation,
  requireJwtSecret,
  runConflictCheck,
  verifyToken,
  DomainError,
  type AuthContext,
  type Deps,
} from "@lawlink/core";
import { createDb } from "@lawlink/db";

/** Real JWT secret — throws if unset/placeholder (no forgeable fallback). */
function getSecret(): string {
  return requireJwtSecret(process.env.LAWLINK_JWT_SECRET);
}

/** `secret` is only needed by token-issuing routes (login). `ctx` carries the
 * request ip/userAgent for the audit trail. */
function buildDeps(secret = "", ctx?: { ip?: string; userAgent?: string }): Deps {
  const db = createDb(process.env.LAWLINK_DB_URL ?? "file:./lawlink.db");
  const ids = { newId: () => randomUUID() };
  const clock = { now: () => new Date() };
  return { db, ids, clock, secrets: { jwt: secret }, audit: createAuditSink(db, ids, clock, ctx) };
}

/** Audit context (ip / user-agent) from a request. */
function auditCtx(c: Context): { ip?: string; userAgent?: string } {
  return {
    ip: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip"),
    userAgent: c.req.header("user-agent"),
  };
}

const STATUS: Record<DomainError["code"], 400 | 403 | 404 | 409> = {
  VALIDATION: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
};

function fail(c: Context, err: unknown) {
  if (err instanceof DomainError) return c.json({ error: err.message }, STATUS[err.code]);
  // Input validation failures are client errors, not server faults.
  if (err instanceof ZodError) {
    return c.json({ error: err.issues.map((i) => i.message).join("；") }, 400);
  }
  // Other non-domain errors (e.g. missing JWT secret config) are server-side faults.
  return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
}

type Env = { Variables: { auth: AuthContext } };
const app = new Hono<Env>();

// Allow the SPA dev server (and configured origins) to call the API.
app.use("/api/*", cors({ origin: (process.env.LAWLINK_CORS_ORIGIN ?? "*") }));

app.get("/api/health", (c) => c.json({ name: "lawlink-next", status: "ok" }));

app.get("/api/dashboard", requireAuth, async (c) => {
  try {
    return c.json(await getDashboard(buildDeps(), c.get("auth")));
  } catch (err) {
    return fail(c, err);
  }
});

app.get("/api/audit", requireAuth, async (c) => {
  try {
    const limit = c.req.query("limit");
    return c.json(
      await listAudit(buildDeps(), c.get("auth"), {
        action: c.req.query("action"),
        limit: limit ? Number(limit) : undefined,
      }),
    );
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/auth/login", async (c) => {
  try {
    return c.json(await login(buildDeps(getSecret(), auditCtx(c)), await c.req.json()));
  } catch (err) {
    return fail(c, err);
  }
});

// JWT auth middleware for everything under /api (except the public routes above).
async function requireAuth(c: Context<Env>, next: Next) {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    c.set("auth", await verifyToken(getSecret(), token));
  } catch (err) {
    return fail(c, err);
  }
  await next();
}

app.get("/api/intakes", requireAuth, async (c) => {
  try {
    return c.json(await listIntakes(buildDeps(), c.get("auth")));
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/intakes", requireAuth, async (c) => {
  try {
    return c.json(await createIntake(buildDeps("", auditCtx(c)), c.get("auth"), await c.req.json()), 201);
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/intakes/:id/decline", requireAuth, async (c) => {
  try {
    const body = await c.req.json<{ reason: string }>();
    return c.json(
      await declineIntake(buildDeps("", auditCtx(c)), c.get("auth"), {
        intakeId: c.req.param("id"),
        reason: body.reason,
      }),
    );
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/intakes/:id/convert", requireAuth, async (c) => {
  try {
    return c.json(
      await convertIntake(buildDeps("", auditCtx(c)), c.get("auth"), { intakeId: c.req.param("id") }),
      201,
    );
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/conflicts/check", requireAuth, async (c) => {
  try {
    return c.json(await runConflictCheck(buildDeps("", auditCtx(c)), c.get("auth"), await c.req.json()));
  } catch (err) {
    return fail(c, err);
  }
});

app.get("/api/clients", requireAuth, async (c) => {
  try {
    return c.json(await listClients(buildDeps(), c.get("auth")));
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/clients", requireAuth, async (c) => {
  try {
    return c.json(await createClient(buildDeps("", auditCtx(c)), c.get("auth"), await c.req.json()), 201);
  } catch (err) {
    return fail(c, err);
  }
});

app.get("/api/clients/:id", requireAuth, async (c) => {
  try {
    return c.json(await getClient(buildDeps(), c.get("auth"), { clientId: c.req.param("id") ?? "" }));
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/clients/:id/contacts", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(await addContact(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, clientId: c.req.param("id") }), 201);
  } catch (err) {
    return fail(c, err);
  }
});

app.get("/api/matters", requireAuth, async (c) => {
  try {
    return c.json(await listMatters(buildDeps(), c.get("auth")));
  } catch (err) {
    return fail(c, err);
  }
});

app.get("/api/matters/:id", requireAuth, async (c) => {
  try {
    return c.json(await getMatter(buildDeps(), c.get("auth"), { matterId: c.req.param("id") ?? "" }));
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/matters/:id/procedures", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(
      await addProcedure(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, matterId: c.req.param("id") }),
      201,
    );
  } catch (err) {
    return fail(c, err);
  }
});

app.get("/api/matters/:id/tasks", requireAuth, async (c) => {
  try {
    return c.json(await listMatterTasks(buildDeps(), c.get("auth"), { matterId: c.req.param("id") ?? "" }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/matters/:id/tasks", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(await addTask(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, matterId: c.req.param("id") }), 201);
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/tasks/:id/complete", requireAuth, async (c) => {
  try {
    return c.json(await completeTask(buildDeps("", auditCtx(c)), c.get("auth"), { taskId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});

app.get("/api/matters/:id/notes", requireAuth, async (c) => {
  try {
    return c.json(await listMatterNotes(buildDeps(), c.get("auth"), { matterId: c.req.param("id") ?? "" }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/matters/:id/notes", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(await addNote(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, matterId: c.req.param("id") }), 201);
  } catch (err) {
    return fail(c, err);
  }
});

app.get("/api/matters/:id/hearings", requireAuth, async (c) => {
  try {
    return c.json(await listMatterHearings(buildDeps(), c.get("auth"), { matterId: c.req.param("id") ?? "" }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/procedures/:id/hearings", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(await addHearing(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, procedureId: c.req.param("id") }), 201);
  } catch (err) {
    return fail(c, err);
  }
});

app.get("/api/matters/:id/archive-checklist", requireAuth, async (c) => {
  try {
    return c.json(await getArchiveChecklist(buildDeps(), c.get("auth"), { matterId: c.req.param("id") ?? "" }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/matters/:id/archive", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(await archiveMatter(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, matterId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});

app.get("/api/matters/:id/finance", requireAuth, async (c) => {
  try {
    return c.json(await getMatterFinance(buildDeps(), c.get("auth"), { matterId: c.req.param("id") ?? "" }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/matters/:id/fee-entries", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(await createFeeEntry(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, matterId: c.req.param("id") }), 201);
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/matters/:id/commission-plan", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(await setCommissionPlan(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, matterId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/fee-entries/:id/delete", requireAuth, async (c) => {
  try {
    return c.json(await deleteFeeEntry(buildDeps("", auditCtx(c)), c.get("auth"), { feeEntryId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});

app.get("/api/matters/:id/deadlines", requireAuth, async (c) => {
  try {
    return c.json(await listMatterDeadlines(buildDeps(), c.get("auth"), { matterId: c.req.param("id") ?? "" }));
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/procedures/:id/deadlines/compute", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(
      await applyDeadlineRules(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, procedureId: c.req.param("id") }),
      201,
    );
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/deadlines/:id/complete", requireAuth, async (c) => {
  try {
    return c.json(await completeDeadline(buildDeps("", auditCtx(c)), c.get("auth"), { deadlineId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});

app.get("/api/matters/:id/preservations", requireAuth, async (c) => {
  try {
    return c.json(await listMatterPreservations(buildDeps(), c.get("auth"), { matterId: c.req.param("id") ?? "" }));
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/matters/:id/preservations", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(
      await createPreservation(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, matterId: c.req.param("id") }),
      201,
    );
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/preservations/:id/renew", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(
      await renewPreservation(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, preservationId: c.req.param("id") }),
    );
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/preservations/:id/lift", requireAuth, async (c) => {
  try {
    return c.json(await liftPreservation(buildDeps("", auditCtx(c)), c.get("auth"), { preservationId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});

// ── folders (卷宗) ────────────────────────────────────────────────────────────
app.get("/api/matters/:id/folders", requireAuth, async (c) => {
  try {
    return c.json(await listFolders(buildDeps(), c.get("auth"), { matterId: c.req.param("id") ?? "" }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/matters/:id/folders", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(await createFolder(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, matterId: c.req.param("id") }), 201);
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/folders/:id/rename", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(await renameFolder(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, folderId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/folders/:id/delete", requireAuth, async (c) => {
  try {
    return c.json(await deleteFolder(buildDeps("", auditCtx(c)), c.get("auth"), { folderId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});

// ── documents (材料/文书) ──────────────────────────────────────────────────────
app.get("/api/matters/:id/documents", requireAuth, async (c) => {
  try {
    return c.json(await listDocuments(buildDeps(), c.get("auth"), { matterId: c.req.param("id") ?? "" }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/matters/:id/documents", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(await registerDocument(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, matterId: c.req.param("id") }), 201);
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/documents/:id/move", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(await moveDocument(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, documentId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/documents/:id/submit", requireAuth, async (c) => {
  try {
    return c.json(await submitDocumentForReview(buildDeps("", auditCtx(c)), c.get("auth"), { documentId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/documents/:id/approve", requireAuth, async (c) => {
  try {
    return c.json(await approveDocument(buildDeps("", auditCtx(c)), c.get("auth"), { documentId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/documents/:id/reject", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    return c.json(await rejectDocument(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, documentId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/documents/:id/file", requireAuth, async (c) => {
  try {
    return c.json(await fileDocument(buildDeps("", auditCtx(c)), c.get("auth"), { documentId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/documents/:id/delete", requireAuth, async (c) => {
  try {
    return c.json(await deleteDocument(buildDeps("", auditCtx(c)), c.get("auth"), { documentId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});

// ── users (用户目录, ADMIN) ─────────────────────────────────────────────────────
app.get("/api/users", requireAuth, async (c) => {
  try {
    return c.json(await listUsers(buildDeps(), c.get("auth"), { activeOnly: c.req.query("activeOnly") === "true" }));
  } catch (err) {
    return fail(c, err);
  }
});

// ── settings (设置, ADMIN) ─────────────────────────────────────────────────────
app.get("/api/settings", requireAuth, async (c) => {
  try {
    return c.json(await listSettings(buildDeps(), c.get("auth")));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/settings", requireAuth, async (c) => {
  try {
    return c.json(await setSetting(buildDeps("", auditCtx(c)), c.get("auth"), await c.req.json()));
  } catch (err) {
    return fail(c, err);
  }
});

// ── seals (用印审批) ───────────────────────────────────────────────────────────
// NOTE: /seals/types is registered before /seals/:id so "types" isn't read as an id.
app.get("/api/seals/types", requireAuth, (c) => c.json(listSealTypes()));
app.get("/api/seals", requireAuth, async (c) => {
  try {
    return c.json(await listSealRequests(buildDeps(), c.get("auth"), { status: c.req.query("status") }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/seals", requireAuth, async (c) => {
  try {
    return c.json(await createSealRequest(buildDeps("", auditCtx(c)), c.get("auth"), await c.req.json()), 201);
  } catch (err) {
    return fail(c, err);
  }
});
app.get("/api/seals/:id", requireAuth, async (c) => {
  try {
    return c.json(await getSealRequest(buildDeps(), c.get("auth"), { sealRequestId: c.req.param("id") ?? "" }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/seals/:id/approve", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    return c.json(await approveSealRequest(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, sealRequestId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/seals/:id/reject", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    return c.json(await rejectSealRequest(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, sealRequestId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/seals/:id/stamp", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(await stampSealRequest(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, sealRequestId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/seals/:id/cancel", requireAuth, async (c) => {
  try {
    return c.json(await cancelSealRequest(buildDeps("", auditCtx(c)), c.get("auth"), { sealRequestId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});

// ── sms (法院短信解析) ───────────────────────────────────────────────────────
app.get("/api/sms", requireAuth, async (c) => {
  try {
    const p = c.req.query("processed");
    return c.json(await listSms(buildDeps(), c.get("auth"), { processed: p === undefined ? undefined : p === "true" }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/sms", requireAuth, async (c) => {
  try {
    return c.json(await ingestSms(buildDeps("", auditCtx(c)), c.get("auth"), await c.req.json()), 201);
  } catch (err) {
    return fail(c, err);
  }
});
app.get("/api/sms/:id", requireAuth, async (c) => {
  try {
    return c.json(await getSms(buildDeps(), c.get("auth"), { smsId: c.req.param("id") ?? "" }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/sms/:id/assign", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(await assignSmsMatter(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, smsId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/sms/:id/gen-hearing", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    return c.json(await generateHearingFromSms(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, smsId: c.req.param("id") }), 201);
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/sms/:id/gen-deadline", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    return c.json(await generateDeadlineFromSms(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, smsId: c.req.param("id") }), 201);
  } catch (err) {
    return fail(c, err);
  }
});
app.post("/api/sms/:id/processed", requireAuth, async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    return c.json(await markSmsProcessed(buildDeps("", auditCtx(c)), c.get("auth"), { ...body, smsId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});

// Unknown API routes return JSON 404 — registered AFTER all real /api routes so
// it only catches misses. Crucially this also stops an unknown /api/* path from
// falling through to the SPA static fallback (which would return index.html as
// HTML). Non-API paths are left unmatched here so the Node entry (server.ts) can
// serve the SPA; on Cloudflare the static-assets binding handles them instead.
app.all("/api/*", (c) => c.json({ error: "接口不存在" }, 404));

export default app;
