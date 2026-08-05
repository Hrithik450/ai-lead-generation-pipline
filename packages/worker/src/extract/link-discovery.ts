import type { PageKind } from "@lead/core";

/**
 * Page discovery by anchor text and href, not path guessing.
 *
 * Guessing `/about`, `/team`, `/contact` misses `/ueber-uns`, `/impressum`,
 * `/kontakt`, `/chi-siamo`, `/a-propos` — and the canonical query targets Germany.
 * German sites are legally required (TMG §5) to carry an Impressum with the
 * company's legal name, address, and email: the single highest-yield page for
 * this ICP, and path-guessing never finds it.
 */

interface KindRule {
  kind: PageKind;
  priority: number;
  href: RegExp;
  text: RegExp;
}

const RULES: KindRule[] = [
  {
    kind: "imprint",
    priority: 100,
    href: /\/(impressum|imprint|mentions-legales|legal-notice|aviso-legal|note-legali|colofon)\b/i,
    text: /\b(impressum|imprint|mentions l[ée]gales|legal notice|aviso legal|note legali)\b/i,
  },
  {
    kind: "contact",
    priority: 90,
    href: /\/(contact|kontakt|contacto|contatti|contactez|neem-contact|kapcsolat|contacte)\b/i,
    text: /\b(contact|kontakt|contacto|contatti|contactez[- ]nous|get in touch|schreib|reach us)\b/i,
  },
  {
    kind: "about",
    priority: 80,
    href: /\/(about|about-us|ueber-uns|über-uns|unternehmen|company|a-propos|chi-siamo|quienes-somos|over-ons|om-oss)\b/i,
    text: /\b(about|about us|[uü]ber uns|unternehmen|company|our story|[àa] propos|chi siamo|qui[ée]nes somos|over ons)\b/i,
  },
  {
    kind: "team",
    priority: 70,
    href: /\/(team|people|leadership|management|founders|vorstand|mitarbeiter|equipo|equipe|squadra)\b/i,
    text: /\b(team|our team|people|leadership|management|founders|gr[üu]nder|vorstand|equipo|[ée]quipe)\b/i,
  },
  {
    kind: "careers",
    priority: 40,
    href: /\/(careers|jobs|karriere|stellenangebote|join-us|work-with-us|vacatures|empleo)\b/i,
    text: /\b(careers|jobs|karriere|stellen|join us|work with us|we're hiring|wir stellen ein)\b/i,
  },
];

export interface DiscoveredLink {
  url: string;
  kind: PageKind;
  priority: number;
  label: string;
}

/** Classify one link. Href match outranks anchor-text match; both is best. */
export function classifyLink(href: string, text: string): { kind: PageKind; priority: number } {
  let path = href;
  try {
    path = new URL(href).pathname;
  } catch {
    /* relative href — match against the raw string */
  }
  const label = text.replace(/\s+/g, " ").trim().slice(0, 80);

  for (const rule of RULES) {
    const hrefHit = rule.href.test(path);
    const textHit = rule.text.test(label);
    if (hrefHit && textHit) return { kind: rule.kind, priority: rule.priority + 5 };
    if (hrefHit) return { kind: rule.kind, priority: rule.priority };
    if (textHit) return { kind: rule.kind, priority: rule.priority - 10 };
  }
  return { kind: "other", priority: 0 };
}

/**
 * Pick which pages to fetch after the homepage, best-first within a page budget.
 * At most one page per kind — a second "team" page rarely adds a new fact.
 */
export function selectPages(links: DiscoveredLink[], budget: number): DiscoveredLink[] {
  const ranked = [...links]
    .filter((l) => l.kind !== "other")
    .sort((a, b) => b.priority - a.priority);

  const chosen: DiscoveredLink[] = [];
  const seenKinds = new Set<PageKind>();
  const seenUrls = new Set<string>();

  for (const link of ranked) {
    if (chosen.length >= budget) break;
    if (seenKinds.has(link.kind) || seenUrls.has(link.url)) continue;
    seenKinds.add(link.kind);
    seenUrls.add(link.url);
    chosen.push(link);
  }
  return chosen;
}
