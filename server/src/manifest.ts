import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export type ManifestEntry = {
  name: string;
  size: number;
  mtime: number;
  contentType: string;
};

const EXT_TO_CT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
};

export function contentTypeFor(name: string): string {
  return EXT_TO_CT[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

export async function readLocalManifest(dataDir: string): Promise<ManifestEntry[]> {
  const entries = await readdir(dataDir, { withFileTypes: true });
  const out: ManifestEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(dataDir, entry.name);
    const s = await stat(full);
    out.push({
      name: entry.name,
      size: s.size,
      mtime: s.mtimeMs,
      contentType: contentTypeFor(entry.name),
    });
  }
  return out;
}
