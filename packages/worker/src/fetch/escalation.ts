import * as cheerio from "cheerio";
import { detectChallenge, looksLikeConsentWall, type ChallengeVerdict } from "./challenge.js";

export interface PageSignals {
  visibleTextLength: number;
  scriptByteRatio: number;
  emptyRootMount: boolean;
  isContactLikePath: boolean;
  hasContactAffordance: boolean;
  hasOrganizationJsonLd: boolean;
  challenge: ChallengeVerdict;
  consentWall: boolean;
}

export type EscalationDecision =
  | { action: "keep"; reason: string }
  | { action: "tier1"; reason: string }
  | { action: "tier2"; reason: string; vendor?: string };

const ROOT_MOUNTS = ["#root", "#__next", "#app", "#___gatsby", "[data-reactroot]", "#nuxt", "#svelte"];

const CONTACT_PATH = /(contact|kontakt|impressum|imprint|about|ueber|über|team|legal|mentions-legales|contatti|contacto)/i;

export function stripBoilerplate(html: string): { $: cheerio.CheerioAPI; text: string } {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, template").remove();
  $("nav, header, footer, [role=navigation], [role=banner], [role=contentinfo]").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return { $, text };
}

export function computeSignals(
  url: string,
  status: number,
  headers: Record<string, string>,
  html: string,
): PageSignals {
  const full = cheerio.load(html);
  const scriptBytes = full("script")
    .toArray()
    .reduce((sum, el) => sum + (full(el).html()?.length ?? 0), 0);

  const { text } = stripBoilerplate(html);

  const emptyRootMount = ROOT_MOUNTS.some((sel) => {
    const node = full(sel).first();
    if (node.length === 0) return false;
    return node.children().not("script").length < 5 && (node.text().trim().length ?? 0) < 200;
  });

  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    /* leave empty */
  }

  const hasContactAffordance =
    full('a[href^="mailto:"]').length > 0 ||
    full('a[href^="tel:"]').length > 0 ||
    full("[data-cfemail]").length > 0 ||
    full("form").length > 0;

  // A page carrying an Organization JSON-LD block already has the firmographics
  // in the markup. Rendering it in Chromium adds nothing but a browser launch.
  const hasOrganizationJsonLd = full('script[type="application/ld+json"]')
    .toArray()
    .some((el) => /"@type"\s*:\s*"?\[?[^"]*?(Organization|LocalBusiness|Corporation)/i.test(full(el).text()));

  return {
    visibleTextLength: text.length,
    scriptByteRatio: html.length > 0 ? scriptBytes / html.length : 0,
    emptyRootMount,
    isContactLikePath: CONTACT_PATH.test(path),
    hasContactAffordance,
    hasOrganizationJsonLd,
    challenge: detectChallenge(status, headers, html),
    consentWall: looksLikeConsentWall(html, text),
  };
}

/**
 * The escalation rule.
 *
 * Order matters: challenges are checked FIRST and route to tier 2, never tier 1.
 * A challenge page looks identical to a JS shell by every other signal, and a
 * datacenter browser fails the same challenge the HTTP client just failed.
 */
export function decideEscalation(
  status: number,
  contentType: string | null,
  signals: PageSignals,
): EscalationDecision {
  if (signals.challenge.isChallenge) {
    return {
      action: "tier2",
      reason: `bot challenge detected (${signals.challenge.evidence ?? "unknown"})`,
      vendor: signals.challenge.vendor,
    };
  }

  if (status !== 200) return { action: "keep", reason: `non-200 status ${status}` };

  const mime = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime !== "text/html" && mime !== "application/xhtml+xml") {
    return { action: "keep", reason: `non-html content-type ${mime || "none"}` };
  }

  if (signals.consentWall) {
    return { action: "tier1", reason: "consent wall obscures content" };
  }

  // Structured data present -> the facts are already in the markup. Skip the browser.
  if (signals.hasOrganizationJsonLd && !signals.emptyRootMount) {
    return { action: "keep", reason: "Organization JSON-LD present in markup" };
  }

  if (signals.visibleTextLength < 500) {
    return { action: "tier1", reason: `visible text ${signals.visibleTextLength} < 500 chars` };
  }
  if (signals.emptyRootMount) {
    return { action: "tier1", reason: "empty SPA root mount" };
  }
  if (signals.scriptByteRatio > 0.7) {
    return { action: "tier1", reason: `script bytes ${(signals.scriptByteRatio * 100) | 0}% of document` };
  }
  if (signals.isContactLikePath && !signals.hasContactAffordance) {
    return { action: "tier1", reason: "contact-like page with no mailto/tel/form" };
  }

  return { action: "keep", reason: "server-rendered content sufficient" };
}
