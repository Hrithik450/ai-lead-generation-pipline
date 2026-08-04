/**
 * Bot-challenge detection.
 *
 * This exists because Cloudflare, Akamai, PerimeterX and friends serve challenge
 * interstitials with **HTTP 200** and a very short body. That satisfies every
 * "the page looks empty, use a browser" heuristic — so without an explicit check,
 * a rising block rate silently converts into a Chromium stampede. And a datacenter
 * Chromium fails the same challenge the HTTP client just failed, so escalating to
 * tier 1 burns resources for nothing. Challenges go straight to tier 2 or nowhere.
 */

export type ChallengeVendor =
  | "cloudflare"
  | "akamai"
  | "perimeterx"
  | "datadome"
  | "imperva"
  | "sucuri"
  | "generic";

export interface ChallengeVerdict {
  isChallenge: boolean;
  vendor?: ChallengeVendor;
  evidence?: string;
}

const BODY_SIGNATURES: { vendor: ChallengeVendor; pattern: RegExp }[] = [
  { vendor: "cloudflare", pattern: /cf-browser-verification|cf_chl_opt|__cf_chl_|challenge-platform|cdn-cgi\/challenge-platform/i },
  { vendor: "cloudflare", pattern: /checking your browser before accessing|just a moment\.\.\.|enable javascript and cookies to continue/i },
  { vendor: "cloudflare", pattern: /attention required!\s*\|\s*cloudflare|error 1020|ray id:/i },
  { vendor: "akamai", pattern: /akamai\b.*(reference|bot manager)|_abck|ak_bmsc|reference\s*#\d+\.\w+\.\d+/i },
  { vendor: "perimeterx", pattern: /_px(?:aj|hd|Captcha)|perimeterx|px-captcha|please verify you are a human/i },
  { vendor: "datadome", pattern: /datadome|dd_cookie_test|geo\.captcha-delivery\.com/i },
  { vendor: "imperva", pattern: /incapsula incident id|_incapsula_|imperva|visid_incap/i },
  { vendor: "sucuri", pattern: /sucuri website firewall|cloudproxy/i },
  { vendor: "generic", pattern: /captcha-delivery|hcaptcha\.com\/captcha|g-recaptcha.{0,200}verify you are human|are you a robot\?/i },
  { vendor: "generic", pattern: /access denied.{0,200}(unusual traffic|automated|bot)|request unsuccessful\. incapsula/i },
];

const HEADER_SIGNATURES: { vendor: ChallengeVendor; header: string; pattern: RegExp }[] = [
  { vendor: "cloudflare", header: "cf-mitigated", pattern: /challenge/i },
  { vendor: "datadome", header: "x-datadome", pattern: /protected|challenge/i },
  { vendor: "perimeterx", header: "x-px", pattern: /./ },
];

/** Status codes vendors return for a block even when the body looks like a page. */
const CHALLENGE_STATUS = new Set([401, 403, 405, 406, 429, 503]);

export function detectChallenge(
  status: number,
  headers: Record<string, string>,
  html: string,
): ChallengeVerdict {
  for (const sig of HEADER_SIGNATURES) {
    const value = headers[sig.header];
    if (value && sig.pattern.test(value)) {
      return { isChallenge: true, vendor: sig.vendor, evidence: `header ${sig.header}: ${value}` };
    }
  }

  // Only inspect the head of the body: challenge markers are always near the top,
  // and scanning megabytes of legitimate HTML with 10 regexes is wasted work.
  const head = html.slice(0, 20_000);
  for (const sig of BODY_SIGNATURES) {
    const m = sig.pattern.exec(head);
    if (m) return { isChallenge: true, vendor: sig.vendor, evidence: m[0].slice(0, 120) };
  }

  const server = headers["server"] ?? "";
  if (CHALLENGE_STATUS.has(status)) {
    if (/cloudflare/i.test(server)) {
      return { isChallenge: true, vendor: "cloudflare", evidence: `status ${status} from cloudflare` };
    }
    if (status === 403 || status === 429) {
      return { isChallenge: true, vendor: "generic", evidence: `status ${status}` };
    }
  }

  return { isChallenge: false };
}

/**
 * Consent walls (OneTrust, Cookiebot, Usercentrics) are the inverse problem:
 * they server-render enough text to pass every length check, but the content is
 * banner copy rather than the page. Detected so the page is either dismissed in
 * tier 1 or recorded honestly instead of extracted as garbage.
 */
const CONSENT_SIGNATURES = [
  /onetrust|optanon|ot-sdk-container/i,
  /cookiebot|cookieconsent|cookie-consent-banner/i,
  /usercentrics|uc-banner|klaro|cookieyes|termly/i,
  /borlabs-cookie|complianz|cmplz-/i,
];

export function looksLikeConsentWall(html: string, visibleText: string): boolean {
  const hasVendor = CONSENT_SIGNATURES.some((p) => p.test(html.slice(0, 40_000)));
  if (!hasVendor) return false;
  // A vendor script alone is not a wall — most sites carry one. It's a wall when
  // the visible text is dominated by consent language and there is little else.
  const consentWords = /(cookie|einwilligung|datenschutz|consent|privacy|zustimmen|accept all|akzeptieren)/gi;
  const matches = visibleText.match(consentWords)?.length ?? 0;
  const words = visibleText.split(/\s+/).length;
  return words < 400 && matches >= 4;
}
