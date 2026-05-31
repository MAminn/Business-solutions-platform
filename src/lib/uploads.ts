import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB per file

export interface StoredFile {
  fileName: string;
  url: string;
  size: number;
  mimeType: string;
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.length > 0 ? base.slice(0, 180) : "file";
}

/**
 * Persists an uploaded file to the local public/uploads directory and returns
 * metadata plus a web-accessible URL. Files are namespaced per task.
 */
export async function storeTaskAttachment(
  taskId: string,
  file: File,
): Promise<StoredFile> {
  const safeName = sanitizeFileName(file.name);
  const uniquePrefix = randomUUID();
  const relativeDir = path.posix.join("uploads", "tasks", taskId);
  const absoluteDir = path.join(
    process.cwd(),
    "public",
    "uploads",
    "tasks",
    taskId,
  );

  await mkdir(absoluteDir, { recursive: true });

  const storedName = `${uniquePrefix}-${safeName}`;
  const absolutePath = path.join(absoluteDir, storedName);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(absolutePath, bytes);

  return {
    fileName: safeName,
    url: `/${path.posix.join(relativeDir, storedName)}`,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
  };
}
