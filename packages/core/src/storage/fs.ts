/**
 * Local-filesystem StorageAdapter for the self-host (Node) deploy. Bytes are
 * written under `baseDir`, keyed by storageKey (e.g. `doc/<uuid>`). Cloudflare
 * uses an R2 adapter instead; this file is Node-only and tree-shaken on Workers.
 */
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DomainError, type StorageAdapter } from "../types.js";

export function createFsStorage(baseDir: string): StorageAdapter {
  const root = path.resolve(baseDir);
  const resolveKey = (key: string): string => {
    const p = path.resolve(root, key);
    // Contain within root — reject path traversal via a crafted key.
    if (p !== root && !p.startsWith(root + path.sep)) {
      throw new DomainError("VALIDATION", "非法存储键");
    }
    return p;
  };
  return {
    async put(key, bytes) {
      const f = resolveKey(key);
      await mkdir(path.dirname(f), { recursive: true });
      await writeFile(f, bytes);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(resolveKey(key)));
      } catch {
        throw new DomainError("NOT_FOUND", "文件内容不存在");
      }
    },
    async delete(key) {
      await unlink(resolveKey(key)).catch(() => {});
    },
    async exists(key) {
      try {
        await access(resolveKey(key));
        return true;
      } catch {
        return false;
      }
    },
  };
}
