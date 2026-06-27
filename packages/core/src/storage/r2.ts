/**
 * Cloudflare R2 StorageAdapter for the Workers deploy. Bytes are keyed by
 * storageKey (e.g. `doc/<uuid>`), the same opaque keys the fs/memory adapters
 * use, so the document/template layers are storage-agnostic.
 *
 * We model only the R2 methods we call via a local interface instead of pulling
 * @cloudflare/workers-types — that package's ambient globals (File/Blob/Request…)
 * would leak into Node compilations that import this core barrel. The real
 * R2Bucket from the Worker is structurally compatible.
 */
import { DomainError, type StorageAdapter } from "../types.js";

interface R2BucketLike {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
  head(key: string): Promise<unknown | null>;
}

export function createR2Storage(bucket: R2BucketLike): StorageAdapter {
  return {
    async put(key, bytes, contentType) {
      await bucket.put(key, bytes, contentType ? { httpMetadata: { contentType } } : undefined);
    },
    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) throw new DomainError("NOT_FOUND", "文件内容不存在");
      return new Uint8Array(await obj.arrayBuffer());
    },
    async delete(key) {
      await bucket.delete(key);
    },
    async exists(key) {
      return (await bucket.head(key)) !== null;
    },
  };
}
