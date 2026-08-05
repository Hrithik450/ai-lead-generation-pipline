import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { canonicalizeUrl, domainOf, isNonCompanyDomain, type PageKind, type ProvenanceMethod } from "@lead/core";
import { config } from "../config.js";
import { decodeCfEmail } from "./cfemail.js";
import { classifyLink, type DiscoveredLink } from "./link-discovery.js";

/**
 * Deterministic extraction: everything obtainable without an LLM.
 *
 * This covers contact fields (email, phone, address, socials) reliably and cheaply.
 * It does NOT cover employee_count, funding, or founders — those live in prose and
 * are what the LLM pass is for. Running this first still matters: it produces
 * higher-confidence contact data than the LLM would, and it discovers which pages
 * are worth fetching at all.
 */

export interface DeterministicResult {
  sourceUrl: string;
  kind: PageKind;
  companyName: string | null;
  description: string | null;
  emails: { value: string; method: ProvenanceMethod; sourceUrl: string }[];
  phones: { value: string; method: ProvenanceMethod; sourceUrl: string }[];
  address: string | null;
  country: string | null;
  city: string | null;
  foundedYear: number | null;
  socials: Record<string, string>;
  links: DiscoveredLink[];
  contactFormUrl: string | null;
  /** True when the page offers a form but no address — a distinct outcome from "nothing found". */
  formOnlyContact: boolean;
  cleanText: string;
}

// Role addresses are not personal data under GDPR; named-individual addresses are.
const ROLE_LOCAL_PARTS = new Set([
  "info", "kontakt", "contact", "hello", "hallo", "mail", "email", "office", "team",
  "support", "help", "sales", "vertrieb", "press", "presse", "media", "jobs", "career",
  "careers", "bewerbung", "admin", "service", "enquiries", "enquiry", "inquiries",
  "welcome", "moin", "bonjour", "ciao", "hola", "post", "anfrage", "general",
]);

// The trailing (?![a-zA-Z]) stops the TLD from absorbing a word that follows with
// no separator — "info@acme.deImpressum" would otherwise match as a .de address.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}(?![a-zA-Z])/g;
const PHONE_RE = /(?:\+|00)[\d][\d\s().\-]{7,20}\d/g;

// Files and images whose names look like addresses; filtering these avoids junk leads.
const EMAIL_JUNK = /\.(png|jpe?g|gif|webp|svg|css|js|woff2?|ttf|ico|pdf)$/i;
const EMAIL_PLACEHOLDER = /^(example|test|your|name|user|email|someone|firstname|john\.?doe|max\.?mustermann|sentry|wixpress)@|@(example|sentry|test|domain|email|yourdomain|company)\./i;

export function isRoleEmail(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  const base = local.split(/[+._-]/)[0] ?? local;
  return ROLE_LOCAL_PARTS.has(local) || ROLE_LOCAL_PARTS.has(base);
}

export function extractDeterministic(
  html: string,
  pageUrl: string,
  kind: PageKind,
): DeterministicResult {
  const $ = cheerio.load(html);
  const siteDomain = domainOf(pageUrl);

  const result: DeterministicResult = {
    sourceUrl: pageUrl,
    kind,
    companyName: null,
    description: null,
    emails: [],
    phones: [],
    address: null,
    country: null,
    city: null,
    foundedYear: null,
    socials: {},
    links: [],
    contactFormUrl: null,
    formOnlyContact: false,
    cleanText: "",
  };

  const emailSeen = new Set<string>();
  const phoneSeen = new Set<string>();

  const addEmail = (raw: string, method: ProvenanceMethod) => {
    const email = raw.trim().toLowerCase().replace(/^mailto:/, "").split("?")[0]!;
    if (!email || emailSeen.has(email)) return;
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return;
    if (EMAIL_JUNK.test(email) || EMAIL_PLACEHOLDER.test(email)) return;
    const emailDomain = email.split("@")[1] ?? "";
    if (isNonCompanyDomain(emailDomain)) return;
    // GDPR: named-individual work emails are personal data needing a lawful basis.
    // Default to role addresses only; personal addresses are explicit opt-in.
    if (!config.allowPersonalEmails && !isRoleEmail(email)) return;
    emailSeen.add(email);
    result.emails.push({ value: email, method, sourceUrl: pageUrl });
  };

  const addPhone = (raw: string, method: ProvenanceMethod) => {
    const phone = normalizePhone(raw);
    if (!phone || phoneSeen.has(phone)) return;
    phoneSeen.add(phone);
    result.phones.push({ value: phone, method, sourceUrl: pageUrl });
  };

  // --- Structured data first: highest confidence, lowest ambiguity ---
  for (const node of collectJsonLd($)) {
    applyStructured(node, result, addEmail, addPhone);
  }

  applyMicrodata($, result, addEmail, addPhone);

  // --- OpenGraph / meta ---
  const ogSite = $('meta[property="og:site_name"]').attr("content")?.trim();
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  const ogDesc =
    $('meta[property="og:description"]').attr("content")?.trim() ??
    $('meta[name="description"]').attr("content")?.trim();
  result.companyName ??= ogSite || cleanTitle(ogTitle ?? $("title").text());
  result.description ??= ogDesc ?? null;

  // --- mailto: / tel: links ---
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) addEmail(decodeURIComponent(href.slice(7)), "mailto");
  });
  $('a[href^="tel:"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) addPhone(decodeURIComponent(href.slice(4)), "tel");
  });

  // --- Cloudflare-obfuscated emails ---
  $("[data-cfemail]").each((_, el) => {
    const hex = $(el).attr("data-cfemail");
    const decoded = hex ? decodeCfEmail(hex) : null;
    if (decoded) addEmail(decoded, "cfemail");
  });
  $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const hex = href.split("#")[1];
    const decoded = hex ? decodeCfEmail(hex) : null;
    if (decoded) addEmail(decoded, "cfemail");
  });

  // --- Socials ---
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const abs = canonicalizeUrl(href, pageUrl);
    if (!abs) return;
    const platform = socialPlatform(abs);
    if (platform && !result.socials[platform]) result.socials[platform] = abs;
  });

  // --- Link discovery for the next fetch round (same registrable domain only) ---
  const linkSeen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#")) return;
    const abs = canonicalizeUrl(href, pageUrl);
    if (!abs || domainOf(abs) !== siteDomain) return;
    if (linkSeen.has(abs)) return;
    const label = $(el).text();
    const { kind: linkKind, priority } = classifyLink(abs, label);
    if (linkKind === "other") return;
    linkSeen.add(abs);
    result.links.push({ url: abs, kind: linkKind, priority, label: label.trim().slice(0, 80) });
  });

  // --- Body text scan (contact-ish pages only, to limit false positives) ---
  const bodyText = textWithBoundaries($, $("body"));
  if (kind === "contact" || kind === "imprint" || kind === "about") {
    for (const match of bodyText.match(EMAIL_RE) ?? []) addEmail(match, "regex");
    for (const match of bodyText.match(PHONE_RE) ?? []) addPhone(match, "regex");
    result.address ??= extractAddress($, bodyText);
  }

  result.foundedYear ??= extractFoundedYear(bodyText);

  // --- Contact form ---
  const form = $("form").filter((_, el) => {
    const html = $(el).html() ?? "";
    return /email|e-mail|message|nachricht|betreff|subject|anfrage/i.test(html);
  });
  if (form.length > 0) {
    result.contactFormUrl = pageUrl;
    // Recorded distinctly: "reachable only via form" is actionable, "not found" is not.
    result.formOnlyContact = result.emails.length === 0;
  }

  const clean = cheerio.load(html);
  clean("script, style, noscript, svg, iframe, template, nav, header, footer").remove();
  result.cleanText = textWithBoundaries(clean, clean("body"));

  return result;
}

/**
 * Extract text with element boundaries preserved as whitespace.
 *
 * Cheerio's `.text()` concatenates descendant text nodes with nothing between
 * them, so `<a>info@acme.de</a><span>Managing Director</span>` collapses to
 * "info@acme.deManaging Director" and the email regex — which happily accepts
 * letters after the TLD — captures "info@acme.deManaging". Injecting a separator
 * per element keeps adjacent inline nodes from fusing into one token.
 */
function textWithBoundaries($: cheerio.CheerioAPI, root: cheerio.Cheerio<AnyNode>): string {
  const parts: string[] = [];
  const walk = (node: AnyNode): void => {
    for (const child of $(node).contents().toArray()) {
      if (child.type === "text") {
        parts.push(child.data);
      } else {
        walk(child);
        parts.push(" ");
      }
    }
  };
  root.toArray().forEach((el) => walk(el));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function collectJsonLd($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      flattenJsonLd(parsed, out);
    } catch {
      // Malformed JSON-LD is extremely common; skip silently.
    }
  });
  return out;
}

function flattenJsonLd(node: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (depth > 6 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) flattenJsonLd(item, out, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj["@graph"])) {
    flattenJsonLd(obj["@graph"], out, depth + 1);
  }
  out.push(obj);
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") flattenJsonLd(value, out, depth + 1);
  }
}

const ORG_TYPES = /^(Organization|Corporation|LocalBusiness|NGO|EducationalOrganization|GovernmentOrganization|SportsOrganization|MedicalOrganization|Company|ProfessionalService|SoftwareCompany|OnlineBusiness)$/i;

function applyStructured(
  node: Record<string, unknown>,
  result: DeterministicResult,
  addEmail: (v: string, m: ProvenanceMethod) => void,
  addPhone: (v: string, m: ProvenanceMethod) => void,
): void {
  const type = node["@type"];
  const types = Array.isArray(type) ? type.map(String) : [String(type ?? "")];
  const isOrg = types.some((t) => ORG_TYPES.test(t) || /Organization|Business/i.test(t));
  if (!isOrg) return;

  const name = str(node["name"]) ?? str(node["legalName"]);
  if (name) result.companyName ??= name;

  const desc = str(node["description"]);
  if (desc) result.description ??= desc;

  const email = str(node["email"]);
  if (email) addEmail(email, "jsonld");

  const phone = str(node["telephone"]);
  if (phone) addPhone(phone, "jsonld");

  const founded = str(node["foundingDate"]);
  if (founded) {
    const year = Number.parseInt(founded.slice(0, 4), 10);
    if (year >= 1800 && year <= new Date().getFullYear()) result.foundedYear ??= year;
  }

  const address = node["address"];
  if (address && typeof address === "object") {
    const a = address as Record<string, unknown>;
    const parts = [
      str(a["streetAddress"]),
      str(a["postalCode"]),
      str(a["addressLocality"]),
      str(a["addressCountry"]),
    ].filter(Boolean);
    if (parts.length > 0) result.address ??= parts.join(", ");
    result.city ??= str(a["addressLocality"]);
    result.country ??= str(a["addressCountry"]);
  } else if (typeof address === "string") {
    result.address ??= address;
  }

  const sameAs = node["sameAs"];
  const urls = Array.isArray(sameAs) ? sameAs.map(String) : sameAs ? [String(sameAs)] : [];
  for (const url of urls) {
    const platform = socialPlatform(url);
    if (platform && !result.socials[platform]) result.socials[platform] = url;
  }

  const contactPoints = node["contactPoint"];
  const points = Array.isArray(contactPoints) ? contactPoints : contactPoints ? [contactPoints] : [];
  for (const p of points) {
    if (!p || typeof p !== "object") continue;
    const cp = p as Record<string, unknown>;
    const cpEmail = str(cp["email"]);
    if (cpEmail) addEmail(cpEmail, "jsonld");
    const cpPhone = str(cp["telephone"]);
    if (cpPhone) addPhone(cpPhone, "jsonld");
  }
}

function applyMicrodata(
  $: cheerio.CheerioAPI,
  result: DeterministicResult,
  addEmail: (v: string, m: ProvenanceMethod) => void,
  addPhone: (v: string, m: ProvenanceMethod) => void,
): void {
  const scope = $('[itemtype*="schema.org/Organization"], [itemtype*="schema.org/LocalBusiness"]');
  if (scope.length === 0) return;

  const prop = (name: string): string | null => {
    const el = scope.find(`[itemprop="${name}"]`).first();
    if (el.length === 0) return null;
    return (el.attr("content") ?? el.text()).trim() || null;
  };

  result.companyName ??= prop("name");
  const email = prop("email");
  if (email) addEmail(email, "microdata");
  const phone = prop("telephone");
  if (phone) addPhone(phone, "microdata");
  result.city ??= prop("addressLocality");
  result.country ??= prop("addressCountry");

  const street = prop("streetAddress");
  const postal = prop("postalCode");
  if (street) {
    result.address ??= [street, postal, result.city, result.country].filter(Boolean).join(", ");
  }
}

const SOCIAL_HOSTS: [RegExp, string][] = [
  [/(^|\.)linkedin\.com$/i, "linkedin"],
  [/(^|\.)(twitter\.com|x\.com)$/i, "twitter"],
  [/(^|\.)github\.com$/i, "github"],
  [/(^|\.)facebook\.com$/i, "facebook"],
];

function socialPlatform(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    for (const [pattern, name] of SOCIAL_HOSTS) {
      if (pattern.test(host)) return name;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 7) return null;
  if (digits.replace(/\D/g, "").length > 15) return null;
  // Reject strings that are really dates or IDs picked up by the loose regex.
  if (/^\+?(19|20)\d{2}$/.test(digits)) return null;
  return trimmed.replace(/\s+/g, " ").slice(0, 32);
}

const ADDRESS_LINE = /\b\d{4,5}\s+[A-ZÄÖÜ][a-zäöüß]+|\b[A-ZÄÖÜ][a-zäöüß]+(?:stra(?:ß|ss)e|str\.|weg|platz|allee|gasse)\s+\d+/;

function extractAddress($: cheerio.CheerioAPI, bodyText: string): string | null {
  const addressEl = $("address").first();
  if (addressEl.length > 0) {
    const text = addressEl.text().replace(/\s+/g, " ").trim();
    if (text.length > 10 && text.length < 300) return text;
  }
  const match = ADDRESS_LINE.exec(bodyText);
  if (match) {
    const start = Math.max(0, match.index - 60);
    return bodyText.slice(start, match.index + 80).replace(/\s+/g, " ").trim();
  }
  return null;
}

const FOUNDED_RE = /\b(?:founded|established|gegr[üu]ndet|seit|since|est\.)\s*(?:in\s*)?(19\d{2}|20[0-2]\d)\b/i;

function extractFoundedYear(text: string): number | null {
  const match = FOUNDED_RE.exec(text);
  if (!match) return null;
  const year = Number.parseInt(match[1]!, 10);
  return year >= 1800 && year <= new Date().getFullYear() ? year : null;
}

function cleanTitle(title: string | undefined): string | null {
  if (!title) return null;
  // "Acme GmbH | AI for logistics" -> "Acme GmbH"
  const first = title.split(/\s+[|–—·-]\s+/)[0]?.trim();
  return first && first.length > 1 && first.length < 100 ? first : title.trim().slice(0, 100) || null;
}

function str(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value) && value.length > 0) return str(value[0]);
  return null;
}
