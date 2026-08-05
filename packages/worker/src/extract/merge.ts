import type { Company, Person, Provenance, ProvenanceEntry } from "@lead/core";
import type { DeterministicResult } from "./deterministic.js";

/**
 * Merge deterministic and LLM extraction into one record.
 *
 * Deterministic wins on every field it can produce. A `mailto:` href or a JSON-LD
 * `email` property is ground truth; the same address arriving via the LLM has
 * passed through a paraphrase step that can transpose characters. The LLM is
 * authoritative only for fields no parser can reach — headcount, funding, the
 * match verdict — plus fields where deterministic extraction came up empty.
 *
 * Every field carries provenance. That record is what makes a lead auditable,
 * and under GDPR Art. 14 it doubles as the source disclosure for personal data.
 */

export interface MergedLead {
  companyName: string | null;
  description: string | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  employeeCount: number | null;
  employeeRange: string | null;
  foundedYear: number | null;
  fundingStage: string | null;
  fundingAmount: string | null;
  fundingYear: number | null;
  emails: string[];
  phones: string[];
  socials: Record<string, string | null>;
  people: Person[];
  technologies: string[];
  contactFormUrl: string | null;
  matchesRequirements: boolean;
  matchReason: string | null;
  llmConfidence: number;
  provenance: Provenance;
}

const LLM_FIELD_CONFIDENCE = 0.7;

export function mergeExtraction(
  domain: string,
  homeUrl: string,
  det: DeterministicResult[],
  llm: Company | null,
): MergedLead {
  const provenance: Provenance = {};
  const record = (field: string, entry: ProvenanceEntry) => {
    provenance[field] = entry;
  };

  const fromDet = <T>(
    field: string,
    pick: (d: DeterministicResult) => T | null | undefined,
    method: ProvenanceEntry["method"] = "jsonld",
  ): T | null => {
    for (const d of det) {
      const value = pick(d);
      if (value !== null && value !== undefined && value !== "") {
        record(field, { source_url: d.sourceUrl, method, confidence: 0.95 });
        return value;
      }
    }
    return null;
  };

  const fromLlm = <T>(field: string, value: T | null | undefined): T | null => {
    if (value === null || value === undefined || value === "") return null;
    record(field, { source_url: homeUrl, method: "llm", confidence: LLM_FIELD_CONFIDENCE });
    return value;
  };

  // --- Contact data: deterministic only. See the module note above. ---
  const emails: string[] = [];
  const emailProv: Record<string, ProvenanceEntry> = {};
  for (const d of det) {
    for (const e of d.emails) {
      if (emails.includes(e.value)) continue;
      emails.push(e.value);
      emailProv[e.value] = { source_url: e.sourceUrl, method: e.method, confidence: 0.98 };
    }
  }
  if (emails.length > 0) {
    record("emails", emailProv[emails[0]!]!);
    for (const [value, entry] of Object.entries(emailProv)) record(`email:${value}`, entry);
  }

  const phones: string[] = [];
  for (const d of det) {
    for (const p of d.phones) {
      if (phones.includes(p.value)) continue;
      phones.push(p.value);
      record(`phone:${p.value}`, { source_url: p.sourceUrl, method: p.method, confidence: 0.9 });
    }
  }

  const socials: Record<string, string | null> = {
    linkedin: null,
    twitter: null,
    github: null,
    facebook: null,
  };
  for (const d of det) {
    for (const [platform, url] of Object.entries(d.socials)) {
      if (socials[platform]) continue;
      socials[platform] = url;
      record(`social:${platform}`, { source_url: d.sourceUrl, method: "regex", confidence: 0.95 });
    }
  }
  if (llm?.socials) {
    for (const [platform, url] of Object.entries(llm.socials)) {
      if (socials[platform] || !url) continue;
      socials[platform] = url;
      record(`social:${platform}`, {
        source_url: homeUrl,
        method: "llm",
        confidence: LLM_FIELD_CONFIDENCE,
      });
    }
  }

  const contactFormUrl = fromDet("contact_form_url", (d) => d.contactFormUrl, "regex");

  return {
    companyName: fromDet("company_name", (d) => d.companyName) ?? fromLlm("company_name", llm?.company_name),
    description: fromDet("description", (d) => d.description, "meta") ?? fromLlm("description", llm?.description),
    industry: fromLlm("industry", llm?.industry),
    country: fromDet("country", (d) => d.country) ?? fromLlm("country", llm?.country),
    city: fromDet("city", (d) => d.city) ?? fromLlm("city", llm?.city),
    address: fromDet("address", (d) => d.address, "regex") ?? fromLlm("address", llm?.address),

    // Nothing deterministic can produce these; they are why the LLM call exists.
    employeeCount: fromLlm("employee_count", llm?.employee_count),
    employeeRange: fromLlm("employee_range", llm?.employee_range),
    foundedYear: fromDet("founded_year", (d) => d.foundedYear) ?? fromLlm("founded_year", llm?.founded_year),
    fundingStage: fromLlm("funding_stage", llm?.funding_stage),
    fundingAmount: fromLlm("funding_amount", llm?.funding_amount),
    fundingYear: fromLlm("funding_year", llm?.funding_year),

    emails,
    phones,
    socials,
    people: dedupePeople(llm?.people ?? []),
    technologies: llm?.technologies ?? [],
    contactFormUrl,

    matchesRequirements: llm?.matches_requirements ?? false,
    matchReason: llm?.match_reason ?? "no LLM extraction available for this domain",
    llmConfidence: llm?.confidence ?? 0,
    provenance,
  };
}

function dedupePeople(people: Person[]): Person[] {
  const seen = new Set<string>();
  const out: Person[] = [];
  for (const p of people) {
    const key = p.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
