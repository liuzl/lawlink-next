/**
 * Hono HTTP API — Workers-native entry shell.
 *
 * Thin adapter over @lawlink/core: assemble Deps + AuthContext from the request
 * and delegate to a use case. No business logic here. P5 swaps the local libSQL
 * db for the D1 binding (`createD1Db(c.env.DB)`).
 */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import {
  createIntake,
  declineIntake,
  login,
  verifyToken,
  DomainError,
  type AuthContext,
  type Deps,
} from "@lawlink/core";
import { createDb } from "@lawlink/db";

function jwtSecret(): string {
  return process.env.LAWLINK_JWT_SECRET ?? "dev-secret-change-me";
}

function buildDeps(): Deps {
  return {
    db: createDb(process.env.LAWLINK_DB_URL ?? "file:./lawlink.db"),
    ids: { newId: () => randomUUID() },
    clock: { now: () => new Date() },
    secrets: { jwt: jwtSecret() },
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
  return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
}

type Env = { Variables: { auth: AuthContext } };
const app = new Hono<Env>();

app.get("/api/health", (c) => c.json({ name: "lawlink-next", status: "ok" }));

app.post("/api/auth/login", async (c) => {
  try {
    return c.json(await login(buildDeps(), await c.req.json()));
  } catch (err) {
    return fail(c, err);
  }
});

// JWT auth middleware for everything under /api (except the public routes above).
async function requireAuth(c: Context<Env>, next: Next) {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    c.set("auth", await verifyToken(jwtSecret(), token));
  } catch (err) {
    return fail(c, err);
  }
  await next();
}

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

export default app;
