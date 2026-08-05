import { request } from "undici";
import { config } from "../config.js";

/**
 * Tier 2: managed fetch for pages that returned a bot challenge.
 *
 * This is an adapter slot, not a dependency. With no key configured, tier 2 is
 * disabled and challenged pages are recorded as `blocked` — which is the honest
 * outcome and keeps the run cheap. ScrapingBee and Firecrawl both drop in here.
 *
 * Note on credit multipliers: ScrapingBee charges 75 credits per stealth+JS
 * request, so a "1,000 credit" plan is ~13 real requests against protected sites.
 * Tier 2 is deliberately last-resort.
 */

export interface ManagedFetchResult {
  html: string;
  statusCode: number;
  finalUrl: string;
  provider: string;
}

export function tier2Available(): boolean {
  return Boolean(config.scrapingbeeApiKey || config.firecrawlApiKey);
}

export async function managedFetch(url: string): Promise<ManagedFetchResult | null> {
  if (config.scrapingbeeApiKey) return scrapingBee(url);
  if (config.firecrawlApiKey) return firecrawl(url);
  return null;
}

async function scrapingBee(url: string): Promise<ManagedFetchResult | null> {
  const endpoint = new URL("https://app.scrapingbee.com/api/v1/");
  endpoint.searchParams.set("api_key", config.scrapingbeeApiKey);
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("render_js", "true");
  endpoint.searchParams.set("stealth_proxy", "true");
  endpoint.searchParams.set("block_resources", "true");

  const res = await request(endpoint, {
    method: "GET",
    headersTimeout: 60_000,
    bodyTimeout: 60_000,
  });
  const body = await res.body.text();
  if (res.statusCode >= 400) return null;
  return {
    html: body,
    statusCode: res.statusCode,
    finalUrl: (res.headers["spb-resolved-url"] as string) ?? url,
    provider: "scrapingbee",
  };
}

async function firecrawl(url: string): Promise<ManagedFetchResult | null> {
  const res = await request("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.firecrawlApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ url, formats: ["html"], onlyMainContent: false }),
    headersTimeout: 60_000,
    bodyTimeout: 60_000,
  });
  const json = (await res.body.json()) as {
    success?: boolean;
    data?: { html?: string; metadata?: { sourceURL?: string; statusCode?: number } };
  };
  if (res.statusCode >= 400 || !json.success || !json.data?.html) return null;
  return {
    html: json.data.html,
    statusCode: json.data.metadata?.statusCode ?? 200,
    finalUrl: json.data.metadata?.sourceURL ?? url,
    provider: "firecrawl",
  };
}
