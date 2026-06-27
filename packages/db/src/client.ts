/**
 * DB client factories. The core layer depends only on the `Database` type,
 * so the underlying driver (libSQL locally, D1 on Cloudflare) is swappable.
 */
import { drizzle } from "drizzle-orm/libsql";
import { drizzle as drizzleD1, type AnyD1Database } from "drizzle-orm/d1";
import { createClient } from "@libsql/client";
import * as schema from "./schema.js";

/** Drizzle instance type the core layer programs against. The libSQL and D1
 * drivers both extend BaseSQLiteDatabase<'async', …> and expose the same methods
 * the core uses (select/insert/update/delete/all/run/batch), so the core is
 * driver-agnostic; createD1Db returns a structurally-identical handle (it differs
 * only in the generic ResultType param, hence the cast). */
export type Database = ReturnType<typeof drizzle<typeof schema>>;

/** Local / self-hosted: libSQL (a SQLite file, e.g. "file:./lawlink.db"). */
export function createDb(url: string): Database {
  const client = createClient({ url });
  // WAL + a busy timeout so concurrent writers wait instead of failing with
  // SQLITE_BUSY (these run before any query on libSQL's serialized connection).
  void client.execute("PRAGMA journal_mode = WAL").catch(() => {});
  void client.execute("PRAGMA busy_timeout = 5000").catch(() => {});
  return drizzle(client, { schema });
}

/** Cloudflare D1 (Workers): wrap the `env.DB` binding. D1's `batch()` is atomic,
 * the same contract the core's D1-compatible transactions rely on. */
export function createD1Db(binding: AnyD1Database): Database {
  return drizzleD1(binding, { schema }) as unknown as Database;
}
