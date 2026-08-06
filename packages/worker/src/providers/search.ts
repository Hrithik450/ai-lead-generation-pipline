import { request } from "undici";
import { config } from "../config.js";

/**
 * Web search adapters for domain discovery.
 *
 * Discovery is the one stage with no local fallback: the scraper can only visit
 * domains something told it about. Two providers are wired because they fail
 * differently — Tavily does keyword relevance, Exa does semantic similarity, and
 * an ICP query phrased as a sentence hits very different results on each. Running
 * both and merging costs one credit each and materially widens coverage.
 *
 * Every provider returns the same `SearchHit`, so the orchestrator never learns
 * which one produced a domain. Adding a third is a new function plus a line in
 * `searchProviders()`.
 *
 * Results are untrusted input. A search API returns whatever URL it indexed,
 * including internal hostnames and redirectors, so nothing here is fetched — the
 * hits flow into the tiered fetcher, which applies the SSRF guard and robots
 * check before a single request goes out.
 */

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
  provider: string;
}

export interface SearchProvider {
  name: string;
  search(query: string, limit: number): Promise<SearchHit[]>;
}

/** Providers with a key configured, in preference order. */
export function searchProviders(): SearchProvider[] {
  const providers: SearchProvider[] = [];
  if (config.tavilyApiKey) providers.push({ name: "tavily", search: tavilySearch });
  if (config.exaApiKey) providers.push({ name: "exa", search: exaSearch });
  return providers;
}

export function searchAvailable(): boolean {
  return searchProviders().length > 0;
}

const SEARCH_TIMEOUT_MS = 30_000;

/**
 * Tavily: keyword relevance, tuned for agent use.
 *
 * `search_depth: "basic"` is deliberate — "advanced" costs 2 credits instead of 1
 * and buys deeper page analysis this pipeline does not use, because the tiered
 * fetcher visits every promising domain itself anyway. Only the URL matters here.
 */
async function tavilySearch(query: string, limit: number): Promise<SearchHit[]> {
  const res = await request("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.tavilyApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: Math.min(limit, 20),
      include_answer: false,
      include_raw_content: false,
    }),
    headersTimeout: SEARCH_TIMEOUT_MS,
    bodyTimeout: SEARCH_TIMEOUT_MS,
  });

  const body = await res.body.text();
  if (res.statusCode >= 400) {
    throw new Error(`tavily ${res.statusCode}: ${body.slice(0, 200)}`);
  }

  const json = JSON.parse(body) as {
    results?: { url?: string; title?: string; content?: string }[];
  };
  return (json.results ?? [])
    .filter((r): r is { url: string; title?: string; content?: string } => Boolean(r.url))
    .map((r) => ({
      url: r.url,
      title: r.title ?? "",
      snippet: r.content ?? "",
      provider: "tavily",
    }));
}

/**
 * Exa: embedding similarity over pages.
 *
 * `type: "auto"` lets Exa choose neural or keyword per query. Its neural mode
 * answers "a page like this description" rather than "a page containing these
 * words", which is what an ICP sentence actually is — and it surfaces company
 * sites that never use the industry's standard vocabulary.
 */
async function exaSearch(query: string, limit: number): Promise<SearchHit[]> {
  const res = await request("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": config.exaApiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: Math.min(limit, 25),
      contents: { text: { maxCharacters: 400 } },
    }),
    headersTimeout: SEARCH_TIMEOUT_MS,
    bodyTimeout: SEARCH_TIMEOUT_MS,
  });

  const body = await res.body.text();
  if (res.statusCode >= 400) {
    throw new Error(`exa ${res.statusCode}: ${body.slice(0, 200)}`);
  }

  const json = JSON.parse(body) as {
    results?: { url?: string; title?: string | null; text?: string }[];
  };
  return (json.results ?? [])
    .filter((r): r is { url: string; title?: string | null; text?: string } => Boolean(r.url))
    .map((r) => ({
      url: r.url,
      title: r.title ?? "",
      snippet: r.text ?? "",
      provider: "exa",
    }));
}
