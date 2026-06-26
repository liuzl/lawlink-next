/** Local Node entry — runs the Hono app for self-hosted dev/deploy.
 * On Cloudflare the default export in index.ts is used directly (no node-server). */
import { serve } from "@hono/node-server";
import app from "./index.js";

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`lawlink-next API on http://localhost:${port}`);
