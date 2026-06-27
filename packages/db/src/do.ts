/**
 * Cloudflare Durable Object SQLite backend. A DO has embedded SQLite with REAL
 * synchronous transactions, so the core's interactive read-then-write guards run
 * atomically (unlike D1, which has no interactive transactions). The whole app
 * runs inside one DO; this factory wraps its storage in a drizzle instance.
 *
 * We type the storage param structurally (not via @cloudflare/workers-types)
 * so this Node-published package doesn't drag Workers ambient globals into Node
 * compilations that import the @lawlink/db barrel. The Worker passes the real
 * DurableObjectState.storage, which is structurally compatible.
 */
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import * as schema from "./schema.js";
import { migrationBundle } from "./migrations.bundle.js";

interface DoStorageLike {
  sql: unknown;
  transactionSync: <T>(cb: () => T) => T;
}

export function createDoDb(storage: DoStorageLike) {
  return drizzle(storage as never, { schema });
}

export type DoDatabase = ReturnType<typeof createDoDb>;

/** Apply pending migrations inside the DO (call under blockConcurrencyWhile). */
export async function runDoMigrations(db: DoDatabase): Promise<void> {
  await migrate(db, migrationBundle as unknown as Parameters<typeof migrate>[1]);
}
