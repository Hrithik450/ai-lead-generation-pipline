import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";

export interface ResolvedHost {
  address: string;
  family: 4 | 6;
}

/**
 * Search APIs hand us arbitrary URLs, so every fetch resolves DNS first and
 * refuses private ranges. Without this, a crafted result can make the worker
 * fetch the cloud metadata endpoint or an internal service.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true; // unparseable -> refuse
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true;                          // 0.0.0.0/8
  if (a === 10) return true;                         // private
  if (a === 127) return true;                        // loopback
  if (a === 169 && b === 254) return true;           // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true;  // private
  if (a === 192 && b === 168) return true;           // private
  if (a === 192 && b === 0) return true;             // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true;                         // multicast + reserved + broadcast
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const addr = address.toLowerCase().split("%")[0]!;
  if (addr === "::" || addr === "::1") return true;
  if (addr.startsWith("fe80")) return true;               // link-local
  if (/^f[cd]/.test(addr)) return true;                   // unique local fc00::/7
  if (addr.startsWith("ff")) return true;                 // multicast
  // IPv4-mapped (::ffff:a.b.c.d) — evaluate the embedded v4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) return isPrivateIPv4(mapped[1]!);
  return false;
}

/**
 * Node performs no DNS caching of its own. At 10k lookups this produces EAI_AGAIN
 * storms against the local resolver, so we memoize with a short TTL.
 */
const cache = new Map<string, { value: ResolvedHost; expires: number }>();
const DNS_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE = 5_000;

export function resolveHost(hostname: string): Promise<ResolvedHost> {
  const literal = isIP(hostname);
  if (literal) {
    return Promise.resolve({ address: hostname, family: literal as 4 | 6 });
  }

  const hit = cache.get(hostname);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);

  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { family: 0 }, (err, address, family) => {
      if (err) return reject(err);
      const value: ResolvedHost = { address, family: family as 4 | 6 };
      if (cache.size >= MAX_CACHE) cache.clear();
      cache.set(hostname, { value, expires: Date.now() + DNS_TTL_MS });
      resolve(value);
    });
  });
}

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/** Throws if the URL resolves to a non-public address or uses a non-HTTP scheme. */
export async function assertPublicUrl(url: string): Promise<ResolvedHost> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError(`invalid url: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfError(`refused scheme: ${parsed.protocol}`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new SsrfError(`refused host: ${host}`);
  }
  const resolved = await resolveHost(host);
  if (isPrivateAddress(resolved.address)) {
    throw new SsrfError(`refused private address ${resolved.address} for ${host}`);
  }
  return resolved;
}

export const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

export function isAllowedContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.includes(mime);
}
