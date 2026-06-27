/// <reference types="@cloudflare/workers-types" />
/**
 * Stage-1 Durable Object: proves the Cloudflare-native stack runs locally on DO
 * SQLite (drizzle durable-sqlite + migrations + a JWT-auth read path), WITHOUT
 * touching the 15 interactive transactions yet. The whole app runs INSIDE one DO
 * (single writer = serialized, so the core's synchronous transactions are atomic).
 *
 * Only a minimal surface is mounted here (health / login / list matters); the
 * full route set + transaction sync-rewrite is Stage 2.
 */
import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { ZodError } from "zod";
import { createDoDb, runDoMigrations, users } from "@lawlink/db";
import {
  DomainError,
  createAuditSink,
  createMemoryStorage,
  hashPassword,
  listMatters,
  login,
  requireJwtSecret,
  verifyToken,
  type AuthContext,
  type Deps,
} from "@lawlink/core";

interface DoEnv {
  LAWLINK_JWT_SECRET: string;
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
  if (err instanceof ZodError) return c.json({ error: err.issues.map((i) => i.message).join("；") }, 400);
  return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
}

type AppEnv = { Variables: { auth: AuthContext } };

export class LawlinkDO extends DurableObject<DoEnv> {
  private db: ReturnType<typeof createDoDb>;
  private app: Hono<AppEnv>;
  private ready = false;

  constructor(ctx: DurableObjectState, env: DoEnv) {
    super(ctx, env);
    this.db = createDoDb(ctx.storage);
    this.app = this.buildApp();
  }

  /** deps for the core use-cases (DO db cast to the shared Database type — the
   * query API is identical; the proper union typing lands in Stage 2). */
  private deps(secret = "", auditCtx?: { ip?: string; userAgent?: string }): Deps {
    const db = this.db as unknown as Deps["db"];
    const ids = { newId: () => crypto.randomUUID() };
    const clock = { now: () => new Date() };
    return {
      db,
      ids,
      clock,
      secrets: { jwt: secret },
      audit: createAuditSink(db, ids, clock, auditCtx),
      storage: createMemoryStorage(),
    };
  }

  private secret(): string {
    return requireJwtSecret(this.env.LAWLINK_JWT_SECRET);
  }

  private buildApp(): Hono<AppEnv> {
    const app = new Hono<AppEnv>();
    const auditCtx = (c: Context) => ({
      ip: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip"),
      userAgent: c.req.header("user-agent"),
    });

    const requireAuth = async (c: Context<AppEnv>, next: Next) => {
      const header = c.req.header("authorization") ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      try {
        c.set("auth", await verifyToken(this.secret(), token));
      } catch (err) {
        return fail(c, err);
      }
      await next();
    };

    app.get("/api/health", (c) => c.json({ name: "lawlink-next", runtime: "durable-object", status: "ok" }));

    app.post("/api/auth/login", async (c) => {
      try {
        return c.json(await login(this.deps(this.secret(), auditCtx(c)), await c.req.json()));
      } catch (err) {
        return fail(c, err);
      }
    });

    app.get("/api/matters", requireAuth, async (c) => {
      try {
        return c.json(await listMatters(this.deps(), c.get("auth")));
      } catch (err) {
        return fail(c, err);
      }
    });

    return app;
  }

  /** Migrate + (dev) seed an admin once, serialized via blockConcurrencyWhile. */
  private async ensureReady(): Promise<void> {
    if (this.ready) return;
    await this.ctx.blockConcurrencyWhile(async () => {
      await runDoMigrations(this.db);
      const [existing] = await this.db.select({ id: users.id }).from(users).limit(1);
      if (!existing) {
        await this.db.insert(users).values({
          id: crypto.randomUUID(),
          name: "系统管理员",
          email: "admin@lawlink.local",
          passwordHash: await hashPassword("ChangeMe!2026"),
          role: "ADMIN",
          active: true,
          createdAt: new Date(),
        });
      }
    });
    this.ready = true;
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureReady();
    return this.app.fetch(request);
  }
}
