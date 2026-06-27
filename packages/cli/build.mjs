/**
 * Bundle the CLI to a single runnable JS file so `lawlink` works under plain
 * `node` (no tsx). The workspace packages (@lawlink/core, @lawlink/db) are
 * TS-only, so we bundle their source in; native modules stay external (they
 * can't be bundled and resolve from node_modules at runtime).
 */
import { build } from "esbuild";
import { chmodSync } from "node:fs";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  // CJS output (.cjs): the bundle pulls in CJS deps (commander, libsql wrapper)
  // that `require()` node builtins — an ESM bundle would choke on those dynamic
  // requires. The entry's `#!/usr/bin/env node` shebang is preserved on top.
  format: "cjs",
  target: "node18",
  outfile: "dist/index.cjs",
  // Native / runtime-resolved deps — not bundleable; resolved from node_modules.
  external: ["@libsql/client", "libsql"],
  logLevel: "info",
});

chmodSync("dist/index.cjs", 0o755);
console.log("built dist/index.cjs");
