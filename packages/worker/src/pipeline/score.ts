import type { Requirements } from "@lead/core";
import type { ValidatedLead } from "./validate.js";

/**
 * Score a lead against the requirements the user actually asked for.
 *
 * Two things this deliberately is not:
 *
 * It is not a filter. A lead that misses one requirement still ranks, just lower,
 * because the requirements came from an LLM reading a sentence and are themselves
 * approximate — hard-filtering on `employee_min: 20` silently discards a company
 * whose site simply never states a headcount.
 *
 * It is not a quality score. Contactability is weighted heavily because an
 * unreachable perfect match cannot be acted on, and acting on leads is the point.
 *
 * Unknown is scored between match and mismatch rather than as either. Scoring an
 * absent field as a match fills the top of the list with companies that merely
 * failed to publish anything; scoring it as a mismatch buries every company with
 * a sparse website regardless of fit.
 */

export interface ScoreBreakdown extends Record<string, number> {
  industry: number;
  geography: number;
  size: number;
  funding: number;
  contactability: number;
  evidence: number;
  penalties: number;
}

export interface ScoredLead extends ValidatedLead {
  score: number;
  /** Per-term contribution plus the total, persisted so a rank is explainable. */
  scoreBreakdown: ScoreBreakdown;
}

/** Weights sum to 100 before penalties. */
const WEIGHTS = {
  industry: 22,
  geography: 18,
  size: 15,
  funding: 15,
  contactability: 20,
  evidence: 10,
} as const;

/** Credit for a requirement the site never addresses. See the module note. */
const UNKNOWN = 0.45;

export function scoreLead(lead: ValidatedLead, req: Requirements): ScoredLead {
  const breakdown: ScoreBreakdown = {
    industry: WEIGHTS.industry * scoreIndustry(lead, req),
    geography: WEIGHTS.geography * scoreGeography(lead, req),
    size: WEIGHTS.size * scoreSize(lead, req),
    funding: WEIGHTS.funding * scoreFunding(lead, req),
    contactability: WEIGHTS.contactability * scoreContactability(lead),
    evidence: WEIGHTS.evidence * scoreEvidence(lead),
    penalties: 0,
  };

  breakdown.penalties = penalties(lead, req);

  const total =
    breakdown.industry +
    breakdown.geography +
    breakdown.size +
    breakdown.funding +
    breakdown.contactability +
    breakdown.evidence +
    breakdown.penalties;

  const score = round2(clamp(total, 0, 100));
  return { ...lead, score, scoreBreakdown: { ...roundAll(breakdown), total: score } };
}

/**
 * How well does the company's own self-description fit the industry asked for?
 *
 * The LLM's `matches_requirements` verdict is read as a positive signal only. It
 * answers whether the company satisfies *every* requirement, so a false is as
 * likely to mean "wrong headcount" as "wrong industry" — treating it as an
 * industry mismatch scored two unmistakable AI companies at zero on a live run
 * because both fell outside the requested employee range.
 */
function scoreIndustry(lead: ValidatedLead, req: Requirements): number {
  const wantsIndustry = req.industry !== null && req.industry.trim().length > 0;
  if (!wantsIndustry && req.keywords.length === 0) return 1;

  if (lead.matchesRequirements) return lead.llmConfidence >= 0.6 ? 1 : 0.8;

  const industryFit = wantsIndustry ? tokenOverlap(req.industry as string, industryText(lead)) : 0;
  const keywordShare =
    req.keywords.length > 0 ? countKeywordHits(lead, req.keywords) / req.keywords.length : 0;
  const fit = Math.max(industryFit, keywordShare);

  if (fit > 0) return clamp(0.45 + fit * 0.45, 0, 0.9);
  if (lead.industry === null && lead.description === null) return UNKNOWN;
  return 0;
}

function scoreGeography(lead: ValidatedLead, req: Requirements): number {
  const wantsCountry = req.countries.length > 0;
  const wantsCity = req.cities.length > 0;
  if (!wantsCountry && !wantsCity) return 1;

  const countryMatch = wantsCountry && lead.country !== null && matchesCountry(lead.country, req.countries);
  const cityMatch = wantsCity && lead.city !== null && matchesAny(lead.city, req.cities);

  if (wantsCity && cityMatch) return 1;
  if (wantsCountry && countryMatch) return wantsCity ? 0.75 : 1;

  // An address is weak evidence of location, but on a German site the Impressum
  // address is often the only place the country appears at all.
  if (lead.address !== null) {
    if (matchesAny(lead.address, [...req.countries, ...req.cities])) return 0.85;
  }

  if (lead.country === null && lead.city === null && lead.address === null) return UNKNOWN;
  return 0;
}

function scoreSize(lead: ValidatedLead, req: Requirements): number {
  const { employee_min: min, employee_max: max } = req;
  if (min === null && max === null) return 1;

  const range = employeeBounds(lead);
  if (range === null) return UNKNOWN;

  const [low, high] = range;
  const withinLow = min === null || high >= min;
  const withinHigh = max === null || low <= max;
  if (withinLow && withinHigh) return 1;

  // Partial credit by distance: 40 employees against a 20-30 requirement is a
  // near miss worth surfacing, 4000 is not.
  const target = min !== null && high < min ? min : (max as number);
  const actual = min !== null && high < min ? high : low;
  const ratio = target === 0 ? 0 : Math.min(target, actual) / Math.max(target, actual);
  return clamp(ratio - 0.3, 0, 0.5);
}

function scoreFunding(lead: ValidatedLead, req: Requirements): number {
  if (!req.funding_required) return 1;

  const hasSignal = lead.fundingStage !== null || lead.fundingAmount !== null || lead.fundingYear !== null;
  if (!hasSignal) return UNKNOWN;

  if (req.funding_since_year === null) return 1;
  if (lead.fundingYear === null) {
    // Funded, but the site does not date the round. That is common in press-page
    // copy and should not be scored as failing the recency requirement outright.
    return 0.6;
  }
  if (lead.fundingYear >= req.funding_since_year) return 1;

  const yearsStale = req.funding_since_year - lead.fundingYear;
  return clamp(0.5 - yearsStale * 0.15, 0, 0.5);
}

/**
 * How actionable is this lead?
 *
 * A role email is the top of the ladder: reachable, and not personal data under
 * GDPR. A named individual's address is more actionable still but carries a
 * lawful-basis obligation, so it is not rewarded above a role address here.
 */
function scoreContactability(lead: ValidatedLead): number {
  let score = 0;
  if (lead.emails.length > 0) score += 0.6;
  if (lead.phones.length > 0) score += 0.2;
  if (lead.contactFormUrl !== null) score += lead.emails.length > 0 ? 0.05 : 0.25;
  if (lead.socials.linkedin) score += 0.15;
  return clamp(score, 0, 1);
}

/**
 * How much of the record is corroborated rather than inferred?
 *
 * Reads provenance rather than counting populated fields, because a record filled
 * entirely by one LLM pass over thin page text is exactly the case this should
 * rank below a sparser record built from JSON-LD and a mailto: link.
 */
function scoreEvidence(lead: ValidatedLead): number {
  const entries = Object.values(lead.provenance);
  if (entries.length === 0) return 0;

  const deterministic = entries.filter((e) => e.method !== "llm" && e.method !== "search").length;
  const deterministicShare = deterministic / entries.length;
  const breadth = clamp(entries.length / 12, 0, 1);

  return clamp(0.55 * deterministicShare + 0.3 * breadth + 0.15 * lead.llmConfidence, 0, 1);
}

/**
 * Penalties, applied after weighting so they can override a strong fit.
 *
 * An exclusion hit is the heaviest single term in the whole function. The user
 * naming an exclusion means they have already decided these are not leads, and a
 * consultancy that matches every other requirement is precisely the case that
 * would otherwise rank near the top.
 */
function penalties(lead: ValidatedLead, req: Requirements): number {
  let penalty = 0;

  const haystack = searchableText(lead);
  const excluded = req.exclusions.filter((term) => term.trim().length > 0 && haystack.includes(term.toLowerCase()));
  if (excluded.length > 0) penalty -= Math.min(45, 25 + (excluded.length - 1) * 10);

  if (req.founded_after !== null && lead.foundedYear !== null && lead.foundedYear < req.founded_after) {
    penalty -= 12;
  }

  // Dropped values mean extraction produced something unusable on this domain,
  // which is a mild signal the rest of the record is shakier than it looks.
  if (lead.issues.length > 2) penalty -= Math.min(6, lead.issues.length);

  if (lead.companyName === null) penalty -= 5;

  return penalty;
}

function employeeBounds(lead: ValidatedLead): [number, number] | null {
  if (lead.employeeCount !== null) return [lead.employeeCount, lead.employeeCount];
  if (lead.employeeRange === null) return null;

  const numbers = lead.employeeRange.match(/\d[\d,.]*/g)?.map((n) => Number(n.replace(/[,.]/g, "")));
  if (!numbers || numbers.length === 0) return null;

  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  // "500+" parses to a single number that is a floor, not a point value.
  if (numbers.length === 1 && /\+|over|more than|mehr als/i.test(lead.employeeRange)) {
    return [low, Number.POSITIVE_INFINITY];
  }
  return [low, high];
}

function countKeywordHits(lead: ValidatedLead, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const haystack = searchableText(lead);
  return keywords.filter((k) => k.trim().length > 0 && haystack.includes(k.toLowerCase())).length;
}

/**
 * Share of the requirement's meaningful words that appear in the company's text.
 *
 * Substring matching alone fails the common case: the requirement "AI startups"
 * never appears verbatim on a site that calls itself "an AI platform for
 * enterprises". Comparing word sets finds the overlap that phrase matching misses.
 */
function tokenOverlap(requirement: string, text: string): number {
  const wanted = meaningfulWords(requirement);
  if (wanted.length === 0) return 0;
  const present = new Set(meaningfulWords(text));
  return wanted.filter((w) => present.has(w)).length / wanted.length;
}

/** Words too generic to carry industry meaning; they match nearly every company. */
const STOPWORDS = new Set([
  "and", "the", "for", "with", "that", "this", "our", "their", "company", "companies",
  "startup", "startups", "business", "businesses", "firm", "solution", "solutions",
  "platform", "software", "service", "services", "technology", "technologies",
]);

function meaningfulWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
    ),
  ];
}

function industryText(lead: ValidatedLead): string {
  return [lead.industry, lead.description, ...lead.technologies]
    .filter((v): v is string => typeof v === "string")
    .join(" ");
}

/**
 * Country names arrive in whatever form the site used.
 *
 * A live run scored a Berlin company zero on geography because extraction
 * returned "DE" against a requirement of "Germany" — no substring relation exists
 * between the two. Codes and endonyms are mapped to the English name before
 * comparison; anything unmapped falls through to plain matching.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  de: "germany", deu: "germany", ger: "germany", deutschland: "germany",
  at: "austria", aut: "austria", oesterreich: "austria", österreich: "austria",
  ch: "switzerland", che: "switzerland", schweiz: "switzerland", suisse: "switzerland",
  us: "united states", usa: "united states", "u.s.": "united states", "u.s.a.": "united states",
  uk: "united kingdom", gb: "united kingdom", gbr: "united kingdom",
  nl: "netherlands", nld: "netherlands", holland: "netherlands", nederland: "netherlands",
  fr: "france", fra: "france", es: "spain", esp: "spain", espana: "spain", españa: "spain",
  it: "italy", ita: "italy", italia: "italy", se: "sweden", swe: "sweden", sverige: "sweden",
  dk: "denmark", dnk: "denmark", danmark: "denmark", fi: "finland", fin: "finland",
  no: "norway", nor: "norway", pl: "poland", pol: "poland", polska: "poland",
  be: "belgium", bel: "belgium", ie: "ireland", irl: "ireland", pt: "portugal", prt: "portugal",
  ca: "canada", can: "canada", au: "australia", aus: "australia",
  in: "india", ind: "india", il: "israel", isr: "israel",
};

function canonicalCountry(value: string): string {
  const key = value.trim().toLowerCase();
  return COUNTRY_ALIASES[key] ?? key;
}

function matchesCountry(value: string, candidates: string[]): boolean {
  const canonical = canonicalCountry(value);
  if (canonical.length === 0) return false;
  return candidates.some((c) => {
    const cand = canonicalCountry(c);
    if (cand.length === 0) return false;
    return canonical === cand || canonical.includes(cand) || cand.includes(canonical);
  });
}

function searchableText(lead: ValidatedLead): string {
  return [lead.companyName, lead.description, lead.industry, ...lead.technologies]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();
}

function matchesAny(value: string, candidates: string[]): boolean {
  const needle = value.trim().toLowerCase();
  if (needle.length === 0) return false;
  return candidates.some((c) => {
    const cand = c.trim().toLowerCase();
    if (cand.length === 0) return false;
    return needle.includes(cand) || cand.includes(needle);
  });
}

function clamp(n: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundAll(b: ScoreBreakdown): ScoreBreakdown {
  return {
    industry: round2(b.industry),
    geography: round2(b.geography),
    size: round2(b.size),
    funding: round2(b.funding),
    contactability: round2(b.contactability),
    evidence: round2(b.evidence),
    penalties: round2(b.penalties),
  };
}
