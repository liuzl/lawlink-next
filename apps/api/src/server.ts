/**
 * Node entry — runs the Hono app as a SINGLE ORIGIN: it serves the built SPA
 * (apps/web/dist) AND /api from one port, so production needs no separate static
 * host and no CORS. This is the self-host / `node server.ts` path.
 *
 * Dev does NOT use the static serving here: you run Vite (HMR) which proxies
 * /api to this process. On Cloudflare the Worker (index.ts) is deployed directly
 * with the static-assets binding; this file is not used there.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import app from "./index.js";

// Best-effort: load apps/api/.env (Node ≥20.12 native, no dependency) so a local
// run picks up LAWLINK_JWT_SECRET / LAWLINK_DB_URL without exporting them first.
try {
  process.loadEnvFile();
} catch {
  /* no .env present — rely on the ambient environment */
}

const port = Number(process.env.PORT ?? 8787);

// Resolve the SPA build relative to THIS file (not cwd), so the server works the
// same whether launched from the repo root or apps/api. LAWLINK_WEB_DIST overrides.
const here = path.dirname(fileURLToPath(import.meta.url)); // apps/api/src
const webDist = process.env.LAWLINK_WEB_DIST
  ? path.resolve(process.env.LAWLINK_WEB_DIST)
  : path.resolve(here, "../../web/dist");

// Static SPA serving is OPTIONAL: present in prod/preview (after `pnpm build`),
// absent in dev (Vite serves the SPA). API-only is a valid mode.
if (existsSync(path.join(webDist, "index.html"))) {
  // Hashed assets + any real file under dist. /api/* already responded above
  // (incl. the JSON 404), so it never reaches here.
  app.use("/*", serveStatic({ root: webDist }));
  // SPA fallback: client-router paths (/matters/:id, …) return index.html.
  app.get("*", serveStatic({ root: webDist, path: "index.html" }));
  // eslint-disable-next-line no-console
  console.log(`serving SPA from ${webDist}`);
} else {
  // eslint-disable-next-line no-console
  console.log("SPA dist not found — running API-only (use Vite for the SPA in dev)");
}

serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`lawlink-next on http://localhost:${port}`);
