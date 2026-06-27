import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Database } from "./client.js";

/** Node/libSQL migrator (CLI + local dev). Kept lazy: `import.meta.url` is
 * resolved INSIDE the function, not at module top-level, so importing the @lawlink/db
 * barrel from a non-Node runtime (Cloudflare Workers) doesn't crash on init.
 * The Workers/Durable-Object path uses runDoMigrations() instead. */
export async function runMigrations(db: Database): Promise<void> {
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  await migrate(db, { migrationsFolder });
}
