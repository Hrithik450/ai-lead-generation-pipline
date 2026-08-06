import { canonicalizeUrl, domainOf, isBlockedDomain, isNonCompanyDomain } from "@lead/core";
import type { SearchHit } from "../providers/search.js";
import { searchProviders } from "../providers/search.js";

/**
 * Discovery: search queries in, company domains out.
 *
 * The plan's search queries are run across every configured provider and their
 * results collapsed to one entry per registrable domain. That collapse is the
 * whole point — a single company appears as a homepage, a blog post, and a press
 * release across three queries, and enqueuing each would scrape the same site
 * three times and bill three LLM calls for one lead.
 *
 * Nothing here fetches anything. Search results are untrusted URLs, and every
 * safety check that matters (SSRF, robots, blocklist) lives in the fetcher. This
 * stage filters only what is cheap and certain to be useless.
 */

export interface DiscoveredDomain {
  domain: string;
  seedUrl: string;
  /** Which provider surfaced it first, for run-level attribution. */
  source: string;
  /** How many distinct queries surfaced this domain. */
  hits: number;
  title: string;
  snippet: string;
}

export interface DiscoveryResult {
  domains: DiscoveredDomain[];
  /** Per-provider failures. Discovery continues on one provider going down. */
  errors: { provider: string; query: string; message: string }[];
  queriesRun: number;
  hitsSeen: number;
}

export interface DiscoverInput {
  queries: string[];
  targetDomains: number;
  /** Results requested per query per provider. */
  perQuery?: number;
  onProgress?: (message: string) => void | Promise<void>;
}

export async function discoverDomains(input: DiscoverInput): Promise<DiscoveryResult> {
  const providers = searchProviders();
  const result: DiscoveryResult = { domains: [], errors: [], queriesRun: 0, hitsSeen: 0 };
  if (providers.length === 0 || input.queries.length === 0) return result;

  const perQuery = input.perQuery ?? 10;
  const found = new Map<string, DiscoveredDomain>();

  for (const query of input.queries) {
    // Stop issuing paid searches once the target is met. Queries later in the
    // plan are the broadest, so cutting from the end costs the least coverage.
    if (found.size >= input.targetDomains) break;

    // Providers run together: they are independent APIs and the slow one should
    // not delay the fast one on every query in the plan.
    const settled = await Promise.allSettled(
      providers.map((p) => p.search(query, perQuery).then((hits) => ({ provider: p.name, hits }))),
    );
    result.queriesRun += 1;

    for (const [i, outcome] of settled.entries()) {
      const providerName = providers[i]?.name ?? "unknown";
      if (outcome.status === "rejected") {
        const message =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        result.errors.push({ provider: providerName, query, message });
        continue;
      }
      result.hitsSeen += outcome.value.hits.length;
      for (const hit of outcome.value.hits) collect(found, hit);
    }

    await input.onProgress?.(`"${query}" → ${found.size} domains so far`);
  }

  // A domain surfaced by several independent queries is more likely to be a real
  // match than one that appeared once, so those are the ones kept when the search
  // overshoots the target.
  result.domains = [...found.values()]
    .sort((a, b) => b.hits - a.hits || a.domain.localeCompare(b.domain))
    .slice(0, input.targetDomains);

  return result;
}

function collect(found: Map<string, DiscoveredDomain>, hit: SearchHit): void {
  const canonical = canonicalizeUrl(hit.url);
  if (canonical === null) return;

  const domain = domainOf(canonical);
  if (domain === null) return;
  // Blocked hosts are ToS-prohibited or SERP pages; free-mail and site-builder
  // hosts are never a company's own domain. Neither can yield a lead.
  if (isBlockedDomain(domain) || isNonCompanyDomain(domain)) return;

  const existing = found.get(domain);
  if (existing) {
    existing.hits += 1;
    // Prefer the shallowest URL seen for a domain. A blog post ranks higher than
    // a homepage for a specific query, but the homepage is where the company
    // describes itself, and it is the better place for the crawl to start.
    if (depth(canonical) < depth(existing.seedUrl)) existing.seedUrl = canonical;
    return;
  }

  found.set(domain, {
    domain,
    seedUrl: canonical,
    source: hit.provider,
    hits: 1,
    title: hit.title,
    snippet: hit.snippet,
  });
}

function depth(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
