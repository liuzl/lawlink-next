/**
 * Hono HTTP API — Workers-native entry shell.
 *
 * A thin adapter over @lawlink/core: it assembles Deps + AuthContext from the
 * request and delegates to a use case. No business logic lives here.
 *
 * P0 skeleton: health + one route (`POST /api/intakes`) and a stub auth
 * middleware. P1 replaces the stub with JWT (jose) verification; P5 swaps the
 * local libSQL db for the D1 binding (`createD1Db(c.env.DB)`).
 */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { createIntake, type AuthContext, type Deps, type Role } from "@lawlink/core";
import { createDb } from "@lawlink/db";

function buildDeps(): Deps {
  const url = process.env.LAWLINK_DB_URL ?? "file:./lawlink.db";
  return {
    db: createDb(url),
    ids: { newId: () => randomUUID() },
    clock: { now: () => new Date() },
  };
}

// Stub: trust request headers. P1 replaces with verified JWT claims.
function authFrom(c: Context): AuthContext {
  return {
    userId: c.req.header("x-user-id") ?? "anonymous",
    role: (c.req.header("x-role") as Role) ?? "LAWYER",
  };
}

const app = new Hono();

app.get("/api/health", (c) =>
  c.json({ name: "lawlink-next", status: "ok" }),
);

app.post("/api/intakes", async (c) => {
  try {
    const body = await c.req.json();
    const result = await createIntake(buildDeps(), authFrom(c), body);
    return c.json(result, 201);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

export default app;
