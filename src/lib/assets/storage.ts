/**
 * Creative-asset storage driver abstraction.
 *
 * Step 1 ships only the LocalStorageDriver, which persists bytes to a private
 * directory on a local persistent disk (ASSET_LOCAL_DIR). The directory is
 * NOT statically exposed — stored files are served exclusively through the
 * authenticated route at /api/creative-assets/[assetId].
 *
 * `cdnUrl` on CreativeAsset is reserved for a future S3/R2/CDN driver and is
 * intentionally left null while the local driver is in use.
 *
 * SECURITY: storageKey is driver-neutral and always of the shape
 *   `${clientId}/${creativeId}/${assetId}.${ext}`
 * Before any read/write the absolute path is resolved and asserted to stay
 * inside the configured base directory (path-traversal guard). Paths are never
 * built from request input or any Meta-provided filename.
 */

import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import type { ReadStream } from "node:fs";
import path from "node:path";

export interface StorageDriver {
  /** Persist `bytes` under `key`, creating parent directories as needed. */
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  /** Open a readable stream for `key`. Throws if the object does not exist. */
  getStream(key: string): Promise<ReadStream>;
  /** Remove the object at `key`. No-op if it does not exist. */
  delete(key: string): Promise<void>;
  /** Whether an object exists at `key`. */
  exists(key: string): Promise<boolean>;
}

/**
 * Validates that a storageKey is well-formed: forward-slash separated,
 * non-empty segments, no traversal (`.`/`..`), no backslashes, no absolute
 * or drive-letter prefixes. Returns OS-native relative path segments.
 */
function safeSegments(key: string): string[] {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("Invalid storage key: empty");
  }
  if (key.includes("\\") || key.includes("\0")) {
    throw new Error("Invalid storage key: illegal characters");
  }
  const segments = key.split("/");
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.includes(":")
    ) {
      throw new Error("Invalid storage key: illegal segment");
    }
  }
  return segments;
}

export class LocalStorageDriver implements StorageDriver {
  private readonly base: string;

  constructor(baseDir: string) {
    if (!baseDir || baseDir.trim().length === 0) {
      throw new Error("ASSET_LOCAL_DIR is not configured");
    }
    // Canonical, absolute base. All resolved paths must remain inside this.
    this.base = path.resolve(baseDir);
  }

  /**
   * Resolves a storageKey to an absolute path and asserts it stays inside the
   * configured base directory. Throws on any traversal attempt.
   */
  private resolvePath(key: string): string {
    const segments = safeSegments(key);
    const resolved = path.resolve(this.base, ...segments);
    const baseWithSep = this.base.endsWith(path.sep)
      ? this.base
      : this.base + path.sep;
    if (resolved !== this.base && !resolved.startsWith(baseWithSep)) {
      throw new Error("Storage key escapes base directory");
    }
    return resolved;
  }

  async put(key: string, bytes: Buffer, _mime: string): Promise<void> {
    const absolute = this.resolvePath(key);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
  }

  async getStream(key: string): Promise<ReadStream> {
    const absolute = this.resolvePath(key);
    // Surface a missing object as an error before opening the stream so
    // callers can map it to a 404.
    await stat(absolute);
    return createReadStream(absolute);
  }

  async delete(key: string): Promise<void> {
    const absolute = this.resolvePath(key);
    await rm(absolute, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      const absolute = this.resolvePath(key);
      await stat(absolute);
      return true;
    } catch {
      return false;
    }
  }
}

let cachedDriver: StorageDriver | null = null;

/**
 * Returns the configured storage driver. Only "local" is implemented in
 * Step 1; any other value for ASSET_STORAGE_DRIVER throws so misconfiguration
 * fails fast rather than silently writing nowhere.
 */
export function getStorageDriver(): StorageDriver {
  if (cachedDriver) return cachedDriver;

  const driver = (process.env.ASSET_STORAGE_DRIVER ?? "local").toLowerCase();
  if (driver !== "local") {
    throw new Error(
      `Unsupported ASSET_STORAGE_DRIVER "${driver}" (only "local" is implemented)`,
    );
  }

  const baseDir = process.env.ASSET_LOCAL_DIR;
  if (!baseDir) {
    throw new Error("ASSET_LOCAL_DIR is not configured");
  }

  cachedDriver = new LocalStorageDriver(baseDir);
  return cachedDriver;
}

/**
 * Builds the driver-neutral storageKey for a creative asset. The extension is
 * derived from our own resolved MIME type — never from a Meta-provided file
 * name or any request input.
 */
export function buildStorageKey(
  clientId: string,
  creativeId: string,
  assetId: string,
  ext: string,
): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${clientId}/${creativeId}/${assetId}.${safeExt}`;
}
