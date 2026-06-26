/**
 * Hono HTTP API — Workers-native entry shell.
 *
 * Thin adapter over @lawlink/core: assemble Deps + AuthContext from the request
 * and delegate to a use case. No business logic here. P5 swaps the local libSQL
 * db for the D1 binding (`createD1Db(c.env.DB)`).
 */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context, Next } from "hono";
import {
  addProcedure,
  applyDeadlineRules,
  completeDeadline,
  convertIntake,
  createIntake,
  createPreservation,
  declineIntake,
  getMatter,
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

/** `secret` is only needed by token-issuing routes (login). */
function buildDeps(secret = ""): Deps {
  return {
    db: createDb(process.env.LAWLINK_DB_URL ?? "file:./lawlink.db"),
    ids: { newId: () => randomUUID() },
    clock: { now: () => new Date() },
    secrets: { jwt: secret },
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
  // Non-domain errors (e.g. missing JWT secret config) are server-side faults.
  return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
}

type Env = { Variables: { auth: AuthContext } };
const app = new Hono<Env>();

// Allow the SPA dev server (and configured origins) to call the API.
app.use("/api/*", cors({ origin: (process.env.LAWLINK_CORS_ORIGIN ?? "*") }));

app.get("/api/health", (c) => c.json({ name: "lawlink-next", status: "ok" }));

app.post("/api/auth/login", async (c) => {
  try {
    return c.json(await login(buildDeps(getSecret()), await c.req.json()));
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
    return c.json(await createIntake(buildDeps(), c.get("auth"), await c.req.json()), 201);
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/intakes/:id/decline", requireAuth, async (c) => {
  try {
    const body = await c.req.json<{ reason: string }>();
    return c.json(
      await declineIntake(buildDeps(), c.get("auth"), {
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
      await convertIntake(buildDeps(), c.get("auth"), { intakeId: c.req.param("id") }),
      201,
    );
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/conflicts/check", requireAuth, async (c) => {
  try {
    return c.json(await runConflictCheck(buildDeps(), c.get("auth"), await c.req.json()));
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
      await addProcedure(buildDeps(), c.get("auth"), { ...body, matterId: c.req.param("id") }),
      201,
    );
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
      await applyDeadlineRules(buildDeps(), c.get("auth"), { ...body, procedureId: c.req.param("id") }),
      201,
    );
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/deadlines/:id/complete", requireAuth, async (c) => {
  try {
    return c.json(await completeDeadline(buildDeps(), c.get("auth"), { deadlineId: c.req.param("id") }));
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
      await createPreservation(buildDeps(), c.get("auth"), { ...body, matterId: c.req.param("id") }),
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
      await renewPreservation(buildDeps(), c.get("auth"), { ...body, preservationId: c.req.param("id") }),
    );
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/preservations/:id/lift", requireAuth, async (c) => {
  try {
    return c.json(await liftPreservation(buildDeps(), c.get("auth"), { preservationId: c.req.param("id") }));
  } catch (err) {
    return fail(c, err);
  }
});

export default app;
