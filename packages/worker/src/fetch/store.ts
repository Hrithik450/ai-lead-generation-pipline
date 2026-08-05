import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config.js";

/**
 * Content-addressed store for raw HTML.
 *
 * Keyed by sha256 of the body, so identical pages across domains (shared CMS
 * templates, mirrored sites) cost one copy. ~2GB per 10k pages before gzip.
 */

export function contentHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function pathFor(hash: string): string {
  // Two-level fan-out keeps directory entry counts sane at 100k+ objects.
  return join(config.storageDir, "pages", hash.slice(0, 2), hash.slice(2, 4), `${hash}.html`);
}

export async function storeContent(body: string): Promise<string> {
  const hash = contentHash(body);
  const path = pathFor(hash);
  await mkdir(dirname(path), { recursive: true });
  // Content-addressed: if the hash exists the bytes are identical, so a rewrite is
  // harmless and cheaper than a stat-then-write round trip.
  await writeFile(path, body, "utf8");
  return hash;
}

export async function loadContent(hash: string): Promise<string | null> {
  try {
    return await readFile(pathFor(hash), "utf8");
  } catch {
    return null;
  }
}
