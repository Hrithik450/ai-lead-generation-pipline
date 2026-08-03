/**
 * URL canonicalization + registrable-domain extraction.
 *
 * We deliberately avoid a Public Suffix List dependency: the list is large, needs
 * refreshing, and for lead generation the only thing riding on it is grouping pages
 * of one company together. A curated multi-part-TLD set covers the cases that matter.
 */

const MULTI_PART_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "sch.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "net.nz", "org.nz",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp",
  "com.br", "net.br", "org.br",
  "co.in", "net.in", "org.in", "firm.in", "gen.in",
  "com.cn", "net.cn", "org.cn", "gov.cn",
  "co.za", "org.za", "net.za",
  "com.sg", "com.hk", "com.tw", "com.mx", "com.ar", "com.tr", "com.pl",
  "co.il", "co.kr", "com.es", "com.pt", "com.ua",
]);

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|msclkid|mc_cid|mc_eid|ref|source|hsa_|_hs|igshid|yclid|dclid|wbraid|gbraid)/i;

/** The registrable domain — `blog.acme.co.uk` -> `acme.co.uk`. */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join(".");
  return lastTwo;
}

export function domainOf(url: string): string | null {
  try {
    return registrableDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

/**
 * Canonical form used as the cache key and dedupe key. Strips tracking params,
 * sorts the rest, drops the fragment and default ports, and normalizes the path.
 */
export function canonicalizeUrl(input: string, base?: string): string | null {
  let u: URL;
  try {
    u = new URL(input, base);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/\.$/, "");
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
    u.port = "";
  }

  const kept = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  u.search = "";
  for (const [k, v] of kept) u.searchParams.append(k, v);

  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
  if (u.pathname === "") u.pathname = "/";

  return u.toString();
}

export function sameRegistrableDomain(a: string, b: string): boolean {
  const da = domainOf(a);
  const db = domainOf(b);
  return da !== null && da === db;
}

/** Domains we refuse to crawl: ToS-prohibited, aggressively anti-bot, or SERP pages. */
const BLOCKED_DOMAINS = new Set([
  "linkedin.com", "crunchbase.com", "zoominfo.com", "apollo.io", "rocketreach.co",
  "glassdoor.com", "indeed.com", "facebook.com", "instagram.com", "threads.net",
  "twitter.com", "x.com", "tiktok.com", "pinterest.com", "reddit.com",
  "google.com", "bing.com", "duckduckgo.com", "yandex.com", "baidu.com",
  "youtube.com", "amazon.com", "wikipedia.org", "medium.com", "substack.com",
  "github.com", "gitlab.com", "producthunt.com", "angel.co", "wellfound.com",
]);

export function isBlockedDomain(domain: string): boolean {
  return BLOCKED_DOMAINS.has(domain);
}

/** Free-mail and hosting domains that are never a company's own site. */
const NON_COMPANY_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
  "aol.com", "icloud.com", "protonmail.com", "proton.me", "gmx.de", "gmx.net", "web.de",
  "mail.ru", "yandex.ru", "qq.com", "163.com",
  "wordpress.com", "wixsite.com", "squarespace.com", "weebly.com", "blogspot.com",
  "sites.google.com", "notion.site", "webflow.io", "github.io", "vercel.app", "netlify.app",
]);

export function isNonCompanyDomain(domain: string): boolean {
  return NON_COMPANY_DOMAINS.has(domain);
}
