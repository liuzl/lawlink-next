/** In-memory StorageAdapter — for tests and contexts without a real blob store. */
import { DomainError, type StorageAdapter } from "../types.js";

export function createMemoryStorage(): StorageAdapter {
  const blobs = new Map<string, Uint8Array>();
  return {
    async put(key, bytes) {
      blobs.set(key, bytes);
    },
    async get(key) {
      const b = blobs.get(key);
      if (!b) throw new DomainError("NOT_FOUND", "文件内容不存在");
      return b;
    },
    async delete(key) {
      blobs.delete(key);
    },
    async exists(key) {
      return blobs.has(key);
    },
  };
}
