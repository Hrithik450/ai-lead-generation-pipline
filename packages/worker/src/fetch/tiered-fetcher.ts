import { Agent, interceptors, request } from "undici";
import { canonicalizeUrl } from "@lead/core";
import { config } from "../config.js";
import { browserPool } from "./browser-pool.js";
import {
  computeSignals,
  decideEscalation,
  stripBoilerplate,
  type PageSignals,
} from "./escalation.js";
import { managedFetch, tier2Available } from "./managed.js";
import {
  acquireHostSlot,
  applyRetryAfter,
  isAllowedByRobots,
  isCircuitOpen,
  recordHostFailure,
  recordHostSuccess,
} from "./politeness.js";
import {
  assertPublicUrl,
  isAllowedContentType,
  isPrivateAddress,
  resolveHost,
  SsrfError,
} from "./ssrf.js";
import { storeContent } from "./store.js";

export type FetchOutcome =
  | "ok"
  | "blocked"
  | "robots_disallowed"
  | "unreachable"
  | "circuit_open"
  | "refused";

export interface FetchResult {
  url: string;
  finalUrl: string;
  outcome: FetchOutcome;
  tier: 0 | 1 | 2;
  statusCode: number | null;
  html: string | null;
  text: string | null;
  contentHash: string | null;
  signals: PageSignals | null;
  escalationReason: string | null;
  error: string | null;
}

/** Global tier-1 rate tracker — a rising ratio means we are being challenged en masse. */
class Tier1Guard {
  private window: { t: number; tier1: boolean }[] = [];
  private readonly windowMs = 5 * 60 * 1000;
  private readonly minSamples = 40;

  record(tier1: boolean): void {
    const now = Date.now();
    this.window.push({ t: now, tier1 });
    const cutoff = now - this.windowMs;
    while (this.window.length > 0 && this.window[0]!.t < cutoff)
      this.window.shift();
  }

  /** True when tier-1 escalations exceed the configured share of recent pages. */
  get isAlarming(): boolean {
    if (this.window.length < this.minSamples) return false;
    const tier1 = this.window.filter((w) => w.tier1).length;
    return tier1 / this.window.length > config.tier1AlarmRatio;
  }

  get ratio(): number {
    if (this.window.length === 0) return 0;
    return this.window.filter((w) => w.tier1).length / this.window.length;
  }
}

export const tier1Guard = new Tier1Guard();

// Node caches no DNS results; at 10k requests that produces EAI_AGAIN storms, so
// undici's DNS interceptor memoizes resolution. Its lookup hook also runs on the
// real connect path, which is where the SSRF check belongs: checking only in
// assertPublicUrl leaves a DNS-rebinding window between check and connect.
const agent = new Agent({
  connect: { timeout: 10_000 },
  headersTimeout: config.requestTimeoutMs,
  bodyTimeout: config.requestTimeoutMs,
  connections: 64,
}).compose(
  interceptors.dns({
    maxTTL: 5 * 60_000,
    maxItems: 5_000,
    lookup: (origin, _opts, cb) => {
      resolveHost(origin.hostname).then(
        (r) => {
          if (isPrivateAddress(r.address)) {
            cb(
              new SsrfError(
                `refused private address ${r.address} for ${origin.hostname}`,
              ),
              [],
            );
            return;
          }
          cb(null, [{ address: r.address, family: r.family, ttl: 300 }]);
        },
        (err) => cb(err as NodeJS.ErrnoException, []),
      );
    },
  }),
  interceptors.redirect({ maxRedirections: 5 }),
  interceptors.decompress(),
);

function emptyResult(
  url: string,
  outcome: FetchOutcome,
  error: string | null,
): FetchResult {
  return {
    url,
    finalUrl: url,
    outcome,
    tier: 0,
    statusCode: null,
    html: null,
    text: null,
    contentHash: null,
    signals: null,
    escalationReason: null,
    error,
  };
}

/**
 * Fetch one page through the tier ladder.
 *
 * Tier 0 (HTTP) handles most B2B marketing sites, which are server-rendered.
 * Tier 1 (Playwright) fires only on genuine JS-shell evidence.
 * Tier 2 (managed) fires only on a confirmed bot challenge.
 */
export async function fetchPage(rawUrl: string): Promise<FetchResult> {
  const url = canonicalizeUrl(rawUrl);
  if (!url) return emptyResult(rawUrl, "refused", "uncanonicalizable url");

  if (isCircuitOpen(url))
    return emptyResult(url, "circuit_open", "host circuit breaker open");

  try {
    await assertPublicUrl(url);
  } catch (err) {
    const message = err instanceof SsrfError ? err.message : String(err);
    return emptyResult(url, "refused", message);
  }

  if (!(await isAllowedByRobots(url))) {
    return emptyResult(url, "robots_disallowed", "disallowed by robots.txt");
  }

  await acquireHostSlot(url);

  const tier0 = await fetchTier0(url);
  if (tier0.outcome !== "ok" || !tier0.html) {
    recordHostFailure(url);
    tier1Guard.record(false);
    return tier0.result;
  }

  const decision = decideEscalation(
    tier0.statusCode ?? 0,
    tier0.contentType,
    tier0.signals!,
  );

  if (decision.action === "keep") {
    recordHostSuccess(url);
    tier1Guard.record(false);
    return { ...tier0.result, escalationReason: decision.reason };
  }

  if (decision.action === "tier2") {
    // Challenge page. A datacenter Chromium fails the same challenge, so tier 1
    // is skipped entirely — escalating here would multiply load under a block.
    tier1Guard.record(false);
    recordHostFailure(url);
    if (!tier2Available()) {
      return {
        ...tier0.result,
        outcome: "blocked",
        html: null,
        text: null,
        escalationReason: `${decision.reason}; tier 2 not configured`,
      };
    }
    const managed = await runTier2(url, decision.reason);
    return (
      managed ?? {
        ...tier0.result,
        outcome: "blocked",
        html: null,
        text: null,
        escalationReason: decision.reason,
      }
    );
  }

  tier1Guard.record(true);
  const tier1 = await runTier1(url, decision.reason);
  if (tier1) {
    recordHostSuccess(url);
    return tier1;
  }
  recordHostFailure(url);
  return {
    ...tier0.result,
    escalationReason: `${decision.reason}; tier 1 failed, kept tier 0`,
  };
}

interface Tier0Response {
  outcome: FetchOutcome;
  html: string | null;
  contentType: string | null;
  statusCode: number | null;
  signals: PageSignals | null;
  result: FetchResult;
}

async function fetchTier0(url: string): Promise<Tier0Response> {
  try {
    const res = await request(url, {
      method: "GET",
      dispatcher: agent,
      headers: {
        "user-agent": config.userAgent,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9,de;q=0.8",
      },
    });

    const headers = normalizeHeaders(res.headers);
    const contentType = headers["content-type"] ?? null;

    if (res.statusCode === 429 || res.statusCode === 503) {
      applyRetryAfter(url, headers["retry-after"]);
    }

    if (!isAllowedContentType(contentType) && res.statusCode < 400) {
      res.body.dump();
      const result = emptyResult(
        url,
        "refused",
        `content-type ${contentType ?? "none"}`,
      );
      return {
        outcome: "refused",
        html: null,
        contentType,
        statusCode: res.statusCode,
        signals: null,
        result,
      };
    }

    const html = await readCapped(res.body, config.maxBodyBytes);
    const finalUrl =
      (res.context as { history?: URL[] } | undefined)?.history
        ?.at(-1)
        ?.toString() ?? url;
    const signals = computeSignals(finalUrl, res.statusCode, headers, html);

    // A non-200 that is not a challenge is simply a dead page.
    if (res.statusCode >= 400 && !signals.challenge.isChallenge) {
      const result = emptyResult(url, "unreachable", `http ${res.statusCode}`);
      result.statusCode = res.statusCode;
      result.finalUrl = finalUrl;
      return {
        outcome: "unreachable",
        html: null,
        contentType,
        statusCode: res.statusCode,
        signals,
        result,
      };
    }

    const { text } = stripBoilerplate(html);
    const hash = await storeContent(html);

    const result: FetchResult = {
      url,
      finalUrl,
      outcome: "ok",
      tier: 0,
      statusCode: res.statusCode,
      html,
      text,
      contentHash: hash,
      signals,
      escalationReason: null,
      error: null,
    };
    return {
      outcome: "ok",
      html,
      contentType,
      statusCode: res.statusCode,
      signals,
      result,
    };
  } catch (err) {
    const result = emptyResult(
      url,
      "unreachable",
      String((err as Error)?.message ?? err),
    );
    return {
      outcome: "unreachable",
      html: null,
      contentType: null,
      statusCode: null,
      signals: null,
      result,
    };
  }
}

async function runTier1(
  url: string,
  reason: string,
): Promise<FetchResult | null> {
  try {
    return await browserPool.withPage(async (page) => {
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      // Give client-side rendering a moment, but never block on networkidle —
      // analytics beacons and long-poll connections keep it from ever firing.
      await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => {});
      await dismissConsent(page);
      await page.waitForTimeout(600);

      const html = await page.content();
      const finalUrl = page.url();
      const status = response?.status() ?? 200;
      const headers = response
        ? await response.allHeaders().catch(() => ({}))
        : {};
      const signals = computeSignals(finalUrl, status, headers, html);
      const { text } = stripBoilerplate(html);
      const hash = await storeContent(html);

      return {
        url,
        finalUrl,
        outcome: "ok" as const,
        tier: 1 as const,
        statusCode: status,
        html,
        text,
        contentHash: hash,
        signals,
        escalationReason: reason,
        error: null,
      };
    });
  } catch {
    return null;
  }
}

async function runTier2(
  url: string,
  reason: string,
): Promise<FetchResult | null> {
  try {
    const managed = await managedFetch(url);
    if (!managed) return null;
    const signals = computeSignals(
      managed.finalUrl,
      managed.statusCode,
      {},
      managed.html,
    );
    if (signals.challenge.isChallenge) return null; // provider got challenged too
    const { text } = stripBoilerplate(managed.html);
    const hash = await storeContent(managed.html);
    return {
      url,
      finalUrl: managed.finalUrl,
      outcome: "ok",
      tier: 2,
      statusCode: managed.statusCode,
      html: managed.html,
      text,
      contentHash: hash,
      signals,
      escalationReason: `${reason}; served by ${managed.provider}`,
      error: null,
    };
  } catch {
    return null;
  }
}

const CONSENT_ACCEPT_SELECTORS = [
  "#onetrust-accept-btn-handler",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  "button[data-testid='uc-accept-all-button']",
  ".cmplz-accept",
  "#cookiescript_accept",
  "button[aria-label*='Accept' i]",
  "button:has-text('Accept all')",
  "button:has-text('Alle akzeptieren')",
  "button:has-text('Akzeptieren')",
];

async function dismissConsent(page: import("playwright").Page): Promise<void> {
  for (const selector of CONSENT_ACCEPT_SELECTORS) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 400 })) {
        await el.click({ timeout: 1_500 });
        await page.waitForTimeout(300);
        return;
      }
    } catch {
      // Selector missing or detached — try the next one.
    }
  }
}

function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

async function readCapped(
  body: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > maxBytes) {
      chunks.push(buf.subarray(0, buf.length - (total - maxBytes)));
      break;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}
