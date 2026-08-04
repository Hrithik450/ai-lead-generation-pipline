import { request } from "undici";
import { registrableDomain } from "@lead/core";
import { config } from "../config.js";

/**
 * Per-host politeness.
 *
 * Buckets key on the **registrable domain of the final host after redirects** —
 * rate-limiting the requested URL lets a redirect chain (acme.com -> cdn.acme.com)
 * slip straight past the bucket.
 */
class TokenBucket {
  private nextAllowedAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  async take(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextAllowedAt - now);
    this.nextAllowedAt = Math.max(now, this.nextAllowedAt) + this.minIntervalMs;
    if (wait > 0) await sleep(wait);
  }

  /** Honors Retry-After / Crawl-delay by pushing the next slot out. */
  delayUntil(timestamp: number): void {
    this.nextAllowedAt = Math.max(this.nextAllowedAt, timestamp);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function backoffDelay(attempt: number, baseMs = 1_000, capMs = 30_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(exp / 2 + Math.random() * (exp / 2)); // full-ish jitter
}

/**
 * Per-host circuit breaker. After repeated failures a host is skipped outright
 * rather than retried — otherwise one dead domain eats the run's whole budget.
 */
class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly threshold = 4,
    private readonly cooldownMs = 5 * 60 * 1000,
  ) {}

  get isOpen(): boolean {
    if (this.openedAt === 0) return false;
    if (Date.now() - this.openedAt > this.cooldownMs) {
      this.openedAt = 0;
      this.failures = 0;
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = 0;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = Date.now();
  }
}

interface RobotsRules {
  disallow: string[];
  allow: string[];
  crawlDelayMs: number | null;
}

interface HostState {
  bucket: TokenBucket;
  breaker: CircuitBreaker;
  robots?: Promise<RobotsRules>;
}

const hosts = new Map<string, HostState>();

function stateFor(domain: string): HostState {
  let s = hosts.get(domain);
  if (!s) {
    s = { bucket: new TokenBucket(config.perHostDelayMs), breaker: new CircuitBreaker() };
    hosts.set(domain, s);
  }
  return s;
}

async function fetchRobots(origin: string): Promise<RobotsRules> {
  const empty: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null };
  try {
    const res = await request(`${origin}/robots.txt`, {
      method: "GET",
      headers: { "user-agent": config.userAgent },
      headersTimeout: 8_000,
      bodyTimeout: 8_000,
    });
    if (res.statusCode !== 200) {
      res.body.dump();
      return empty;
    }
    const text = (await res.body.text()).slice(0, 256 * 1024);
    return parseRobots(text);
  } catch {
    // Missing or unreachable robots.txt means no stated restriction.
    return empty;
  }
}

export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null };
  // Track group membership: rules under `User-agent: *` and any group naming our bot.
  let inScope = false;
  let sawAnyGroup = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]!.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      // Consecutive user-agent lines form one group; a directive resets the block.
      if (sawAnyGroup) {
        inScope = false;
        sawAnyGroup = false;
      }
      if (value === "*" || config.userAgent.toLowerCase().includes(value.toLowerCase())) {
        inScope = true;
      }
      continue;
    }

    sawAnyGroup = true;
    if (!inScope) continue;

    if (field === "disallow" && value) rules.disallow.push(value);
    else if (field === "allow" && value) rules.allow.push(value);
    else if (field === "crawl-delay") {
      const secs = Number(value);
      if (Number.isFinite(secs) && secs > 0) rules.crawlDelayMs = Math.min(secs * 1000, 30_000);
    }
  }
  return rules;
}

function matchesRule(path: string, rule: string): boolean {
  // Supports the `*` wildcard and `$` end-anchor from the robots spec.
  const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const anchored = escaped.endsWith("$") ? `^${escaped}` : `^${escaped}`;
  try {
    return new RegExp(anchored).test(path);
  } catch {
    return path.startsWith(rule);
  }
}

export function isAllowedByRules(path: string, rules: RobotsRules): boolean {
  // Longest matching rule wins; Allow beats Disallow at equal length.
  let best: { len: number; allow: boolean } | null = null;
  for (const rule of rules.disallow) {
    if (matchesRule(path, rule) && (!best || rule.length > best.len)) {
      best = { len: rule.length, allow: false };
    }
  }
  for (const rule of rules.allow) {
    if (matchesRule(path, rule) && (!best || rule.length >= best.len)) {
      best = { len: rule.length, allow: true };
    }
  }
  return best ? best.allow : true;
}

export async function isAllowedByRobots(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const domain = registrableDomain(parsed.hostname);
  const state = stateFor(domain);
  state.robots ??= fetchRobots(parsed.origin);
  const rules = await state.robots;
  if (rules.crawlDelayMs) {
    state.bucket.delayUntil(Date.now() + 0); // crawl-delay applied via bucket interval below
  }
  return isAllowedByRules(parsed.pathname + parsed.search, rules);
}

export async function acquireHostSlot(url: string): Promise<void> {
  const domain = domainFromUrl(url);
  if (!domain) return;
  await stateFor(domain).bucket.take();
}

export function isCircuitOpen(url: string): boolean {
  const domain = domainFromUrl(url);
  return domain ? stateFor(domain).breaker.isOpen : false;
}

export function recordHostSuccess(url: string): void {
  const domain = domainFromUrl(url);
  if (domain) stateFor(domain).breaker.recordSuccess();
}

export function recordHostFailure(url: string): void {
  const domain = domainFromUrl(url);
  if (domain) stateFor(domain).breaker.recordFailure();
}

/** Honors a Retry-After header by pushing the host's next slot out. */
export function applyRetryAfter(url: string, retryAfter: string | undefined): void {
  if (!retryAfter) return;
  const domain = domainFromUrl(url);
  if (!domain) return;
  const secs = Number(retryAfter);
  const until = Number.isFinite(secs)
    ? Date.now() + Math.min(secs * 1000, 120_000)
    : Date.parse(retryAfter);
  if (Number.isFinite(until)) stateFor(domain).bucket.delayUntil(until);
}

function domainFromUrl(url: string): string | null {
  try {
    return registrableDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}
