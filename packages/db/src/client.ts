/**
 * DB client factories. The core layer depends only on the `Database` type,
 * so the underlying driver (libSQL locally, D1 on Cloudflare) is swappable.
 */
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema.js";

/** Drizzle instance type the core layer programs against. */
export type Database = ReturnType<typeof drizzle<typeof schema>>;

/** Local / self-hosted: libSQL (a SQLite file, e.g. "file:./lawlink.db"). */
export function createDb(url: string): Database {
  return drizzle(createClient({ url }), { schema });
}

// Cloudflare D1 (Workers) — added in P5:
//   import { drizzle as drizzleD1 } from "drizzle-orm/d1";
//   export const createD1Db = (binding: D1Database) => drizzleD1(binding, { schema });
