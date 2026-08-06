import type { LeadRow } from "@lead/core";

/**
 * Cross-domain deduplication.
 *
 * Discovery returns the same company under more than one domain routinely:
 * acme.com and acme.de, a product domain alongside the corporate one, a rebranded
 * company still serving its old domain. Each is scraped by a different worker and
 * produces a separate lead, and shipping both wastes the same outreach twice.
 *
 * This works on persisted rows rather than in-memory records on purpose. The
 * leads being compared were produced by separate processes, so Postgres is the
 * only place they ever coexist. It runs as a run-level sweep once every domain is
 * terminal — a single job can only see its own domain and cannot dedupe anything.
 *
 * The registrable domain already collapses subdomains before scraping, so this
 * stage only handles what domain equality cannot see. Two signals are trusted: a
 * shared email address, and a matching normalized company name. A shared phone is
 * deliberately not trusted — switchboards and misparsed numbers make it the
 * noisiest of the three.
 */

export interface MergePlan {
  /** The lead that survives and ships. */
  survivor: LeadRow;
  /** Rows folded into it, newest-losing-first. Retained for audit, not shipped. */
  absorbedIds: string[];
  absorbedDomains: string[];
}

export function planDedupe(leads: LeadRow[]): MergePlan[] {
  // Highest score first so the survivor of any group is chosen before merging,
  // which makes the result independent of discovery order.
  const ordered = [...leads].sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));

  const plans: MergePlan[] = [];
  const byEmail = new Map<string, MergePlan>();
  const byName = new Map<string, MergePlan>();

  for (const lead of ordered) {
    const emailKeys = lead.emails.map((e) => e.toLowerCase());
    const nameKey = normalizeCompanyName(lead.company_name);

    let plan: MergePlan | undefined;
    for (const key of emailKeys) {
      plan = byEmail.get(key);
      if (plan) break;
    }
    if (!plan && nameKey !== null) plan = byName.get(nameKey);

    if (plan) {
      absorb(plan, lead);
    } else {
      plan = { survivor: { ...lead }, absorbedIds: [], absorbedDomains: [] };
      plans.push(plan);
    }

    for (const key of emailKeys) {
      if (!byEmail.has(key)) byEmail.set(key, plan);
    }
    if (nameKey !== null && !byName.has(nameKey)) byName.set(nameKey, plan);
  }

  return plans;
}

/**
 * Fold `other` into the survivor.
 *
 * Only fields the survivor is missing are taken. The survivor scored higher,
 * which means its evidence was stronger, so overwriting its values with a weaker
 * record's would lower the quality of the lead that actually ships.
 */
function absorb(plan: MergePlan, other: LeadRow): void {
  const s = plan.survivor;
  plan.absorbedIds.push(other.id);
  plan.absorbedDomains.push(other.domain);

  s.emails = union(s.emails, other.emails);
  s.phones = union(s.phones, other.phones);
  s.technologies = union(s.technologies, other.technologies);

  s.socials = { ...s.socials };
  for (const [platform, url] of Object.entries(other.socials)) {
    if (!s.socials[platform] && url) s.socials[platform] = url;
  }

  s.people = [...s.people];
  for (const person of other.people) {
    const seen = s.people.some((p) => p.name.trim().toLowerCase() === person.name.trim().toLowerCase());
    if (!seen) s.people.push(person);
  }

  s.company_name ??= other.company_name;
  s.website ??= other.website;
  s.description ??= other.description;
  s.industry ??= other.industry;
  s.country ??= other.country;
  s.city ??= other.city;
  s.address ??= other.address;
  s.employee_count ??= other.employee_count;
  s.employee_range ??= other.employee_range;
  s.founded_year ??= other.founded_year;
  s.funding_stage ??= other.funding_stage;
  s.funding_amount ??= other.funding_amount;
  s.funding_year ??= other.funding_year;
  s.contact_form_url ??= other.contact_form_url;

  // Provenance for a field the survivor already had must not be overwritten, or
  // the record would cite a source for a value it is not showing.
  s.provenance = { ...other.provenance, ...s.provenance };
}

function union(a: string[], b: string[]): string[] {
  const out = [...a];
  for (const item of b) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

/** Legal forms and punctuation differ across a company's own domains; the name does not. */
const LEGAL_FORMS =
  /\b(gmbh|mbh|ag|ug|kg|ohg|se|e\.?v|inc|llc|ltd|limited|plc|corp|corporation|co|company|bv|nv|sarl|sas|sa|srl|spa|oy|ab|as|aps|kft|sp\s?z\s?o\s?o|pty|pte)\b/g;

export function normalizeCompanyName(name: string | null): string | null {
  if (!name) return null;
  const normalized = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(LEGAL_FORMS, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Stripping punctuation turns "A.I." into "a i" while plain "AI" stays "ai",
    // so an initialism written both ways on a company's two domains would not
    // match. Rejoining runs of single letters makes the two spellings converge.
    .replace(/\b(?:\p{L} ){1,}\p{L}\b/gu, (run) => run.replace(/ /g, ""));

  // One short token after stripping is too weak to merge on — "AI", "Data", and
  // "Group" would otherwise collapse unrelated companies together.
  if (normalized.length < 4) return null;
  return normalized;
}
