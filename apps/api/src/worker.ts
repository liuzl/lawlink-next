/// <reference types="@cloudflare/workers-types" />
/**
 * Cloudflare Worker entry. The whole app lives in ONE Durable Object (a single
 * writer, so the core's synchronous transactions stay atomic). The Worker just
 * routes every request to that singleton DO. Local dev: `wrangler dev` (miniflare
 * runs a real DO-backed SQLite — no Cloudflare account needed).
 */
import { LawlinkDO } from "./do.js";

export { LawlinkDO };

interface Env {
  LAWLINK_DO: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.LAWLINK_DO.idFromName("singleton");
    return env.LAWLINK_DO.get(id).fetch(request);
  },
} satisfies ExportedHandler<Env>;
