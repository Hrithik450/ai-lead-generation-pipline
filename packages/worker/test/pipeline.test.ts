import { describe, expect, it } from "vitest";
import type { LeadRow, Requirements } from "@lead/core";
import type { MergedLead } from "../src/extract/merge.js";
import { planDedupe, normalizeCompanyName } from "../src/pipeline/dedupe.js";
import { scoreLead } from "../src/pipeline/score.js";
import { normalizePhoneE164, validateLead } from "../src/pipeline/validate.js";

const lead = (over: Partial<MergedLead> = {}): MergedLead => ({
  companyName: "Acme AI GmbH",
  description: "Machine learning for logistics.",
  industry: "AI",
  country: "Germany",
  city: "Berlin",
  address: "Torstraße 1, 10119 Berlin",
  employeeCount: 40,
  employeeRange: null,
  foundedYear: 2021,
  fundingStage: "Series A",
  fundingAmount: "€8M",
  fundingYear: 2025,
  emails: ["info@acme.de"],
  phones: ["+49 30 1234567"],
  socials: { linkedin: "https://linkedin.com/company/acme", twitter: null, github: null, facebook: null },
  people: [],
  technologies: ["python"],
  contactFormUrl: null,
  matchesRequirements: true,
  matchReason: "AI company in Berlin with Series A",
  llmConfidence: 0.8,
  provenance: {
    company_name: { source_url: "https://acme.de/", method: "jsonld", confidence: 0.95 },
    emails: { source_url: "https://acme.de/impressum", method: "mailto", confidence: 0.98 },
  },
  ...over,
});

const requirements = (over: Partial<Requirements> = {}): Requirements => ({
  industry: "AI startups",
  countries: ["Germany"],
  cities: [],
  employee_min: 20,
  employee_max: 100,
  founded_after: null,
  funding_required: true,
  funding_since_year: 2024,
  keywords: ["machine learning"],
  exclusions: ["consultancy"],
  ...over,
});

describe("phone normalization", () => {
  it("normalizes international formats to bare E.164", () => {
    expect(normalizePhoneE164("+49 (0)30 1234-567")).toBe("+49301234567");
    expect(normalizePhoneE164("0049 30 1234567")).toBe("+49301234567");
  });

  // Without a country code a number cannot be dialed by someone who does not
  // already know where the company is, and guessing from the TLD misdials.
  it("rejects national-format numbers rather than guessing a country", () => {
    expect(normalizePhoneE164("030 1234567")).toBeNull();
    expect(normalizePhoneE164("(555) 123-4567")).toBeNull();
  });

  it("rejects placeholders and out-of-range lengths", () => {
    expect(normalizePhoneE164("+111111111")).toBeNull();
    expect(normalizePhoneE164("+4930")).toBeNull();
    expect(normalizePhoneE164("+4930123456789012345")).toBeNull();
  });
});

describe("lead validation", () => {
  // Agency and platform addresses sit in footers constantly and look valid, but
  // reach someone with no authority over the company being researched.
  it("drops an email belonging to a different company", () => {
    const r = validateLead(lead({ emails: ["info@acme.de", "hello@webagency.com"] }), "acme.de");
    expect(r.emails).toEqual(["info@acme.de"]);
    expect(r.issues[0]?.reason).toContain("webagency.com");
  });

  it("keeps a subdomain address for the same company", () => {
    const r = validateLead(lead({ emails: ["info@mail.acme.de"] }), "acme.de");
    expect(r.emails).toEqual(["info@mail.acme.de"]);
  });

  it("drops an employee count that is really a market statistic", () => {
    const r = validateLead(lead({ employeeCount: 4_000_000 }), "acme.de");
    expect(r.employeeCount).toBeNull();
  });

  // A round predating the company means the year came from unrelated copy.
  it("drops a funding year before the company existed", () => {
    const r = validateLead(lead({ foundedYear: 2021, fundingYear: 2015 }), "acme.de");
    expect(r.fundingYear).toBeNull();
    expect(r.foundedYear).toBe(2021);
  });

  it("drops section headings the LLM returned as people", () => {
    const r = validateLead(
      lead({
        people: [
          { name: "Our Leadership", role: null, email: null, linkedin: null },
          { name: "Lena Brandt", role: "CTO", email: null, linkedin: null },
        ],
      }),
      "acme.de",
    );
    expect(r.people.map((p) => p.name)).toEqual(["Lena Brandt"]);
  });

  it("drops a social url that does not point at the platform", () => {
    const r = validateLead(
      lead({ socials: { linkedin: "https://acme.de/linkedin", twitter: null, github: null, facebook: null } }),
      "acme.de",
    );
    expect(r.socials.linkedin).toBeNull();
  });
});

describe("scoring", () => {
  const score = (l: MergedLead, req = requirements()) => scoreLead(validateLead(l, "acme.de"), req);

  it("ranks a full match near the top", () => {
    expect(score(lead()).score).toBeGreaterThan(80);
  });

  // The user naming an exclusion means they already decided these are not leads.
  it("pushes an excluded company below a partial match", () => {
    const excluded = score(lead({ description: "A consultancy for machine learning projects." }));
    const partial = score(lead({ employeeCount: 400, fundingStage: null, fundingAmount: null, fundingYear: null }));
    expect(excluded.score).toBeLessThan(partial.score);
  });

  // Scoring absent fields as matches fills the top of the list with companies
  // that merely published nothing.
  it("ranks an unknown field below a confirmed match but above a mismatch", () => {
    const known = score(lead()).scoreBreakdown.size;
    const unknown = score(lead({ employeeCount: null, employeeRange: null })).scoreBreakdown.size;
    const mismatch = score(lead({ employeeCount: 5000 })).scoreBreakdown.size;
    expect(unknown).toBeLessThan(known);
    expect(unknown).toBeGreaterThan(mismatch);
  });

  it("scores a near-miss headcount above a wildly wrong one", () => {
    expect(score(lead({ employeeCount: 130 })).scoreBreakdown.size).toBeGreaterThan(
      score(lead({ employeeCount: 9000 })).scoreBreakdown.size,
    );
  });

  it("reads an employee range rather than requiring an exact count", () => {
    const ranged = score(lead({ employeeCount: null, employeeRange: "20-50" }));
    expect(ranged.scoreBreakdown.size).toBe(score(lead()).scoreBreakdown.size);
  });

  // Both regressions below came from a live run that scored two unmistakable
  // Berlin AI companies near zero on terms they plainly satisfied.

  // matches_requirements is false when ANY requirement fails, so reading it as an
  // industry verdict zeroed the industry term over a headcount mismatch.
  it("still credits industry fit when the lead fails an unrelated requirement", () => {
    const offSize = lead({
      employeeCount: 400,
      matchesRequirements: false,
      matchReason: "AI company, but headcount exceeds the requested range",
    });
    expect(score(offSize).scoreBreakdown.industry).toBeGreaterThan(0);
  });

  it("scores a genuinely unrelated company below an off-size match on industry", () => {
    const unrelated = score(
      lead({
        industry: "Bakery",
        description: "Family bakery serving sourdough bread.",
        technologies: [],
        matchesRequirements: false,
      }),
    );
    const offSize = score(lead({ employeeCount: 400, matchesRequirements: false }));
    expect(unrelated.scoreBreakdown.industry).toBeLessThan(offSize.scoreBreakdown.industry);
  });

  // Extraction returns whatever form the site used; "DE" has no substring
  // relation to "Germany".
  it("treats a country code as the country it stands for", () => {
    expect(score(lead({ country: "DE" })).scoreBreakdown.geography).toBe(
      score(lead({ country: "Germany" })).scoreBreakdown.geography,
    );
    expect(score(lead({ country: "Deutschland" })).scoreBreakdown.geography).toBe(
      score(lead({ country: "Germany" })).scoreBreakdown.geography,
    );
  });

  it("does not credit a country that was not asked for", () => {
    expect(score(lead({ country: "FR", city: null, address: null })).scoreBreakdown.geography).toBe(0);
  });

  it("rewards a reachable company over an unreachable one", () => {    const reachable = score(lead());
    const unreachable = score(lead({ emails: [], phones: [], socials: { linkedin: null, twitter: null, github: null, facebook: null } }));
    expect(reachable.scoreBreakdown.contactability).toBeGreaterThan(unreachable.scoreBreakdown.contactability);
  });

  // A record built entirely by one LLM pass should rank below a sparser record
  // built from JSON-LD and a mailto: link.
  it("ranks deterministic evidence above LLM-only evidence", () => {
    const llmOnly = score(
      lead({
        provenance: {
          company_name: { source_url: "https://acme.de/", method: "llm", confidence: 0.7 },
          emails: { source_url: "https://acme.de/", method: "llm", confidence: 0.7 },
        },
      }),
    );
    expect(score(lead()).scoreBreakdown.evidence).toBeGreaterThan(llmOnly.scoreBreakdown.evidence);
  });

  it("keeps the total inside 0-100 even when every penalty applies", () => {
    const worst = score(
      lead({
        companyName: null,
        description: "consultancy",
        foundedYear: 1990,
        emails: ["x@other.com"],
        phones: ["12345"],
        matchesRequirements: false,
        llmConfidence: 0,
      }),
      requirements({ founded_after: 2020 }),
    );
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThanOrEqual(100);
  });
});

describe("company name normalization", () => {
  it("collapses legal forms and punctuation across a company's domains", () => {
    expect(normalizeCompanyName("Acme AI GmbH")).toBe(normalizeCompanyName("Acme A.I., Inc."));
    expect(normalizeCompanyName("Müller Robotics AG")).toBe(normalizeCompanyName("Muller Robotics"));
  });

  // "AI", "Data", and "Group" would otherwise merge unrelated companies.
  it("refuses to key on a name too short to be distinctive", () => {
    expect(normalizeCompanyName("AI GmbH")).toBeNull();
    expect(normalizeCompanyName("Co.")).toBeNull();
  });
});

const row = (over: Partial<LeadRow> = {}): LeadRow => ({
  id: "id-1",
  run_id: "run-1",
  domain_id: "d-1",
  domain: "acme.de",
  company_name: "Acme AI GmbH",
  website: "https://acme.de",
  description: null,
  industry: null,
  country: null,
  city: null,
  address: null,
  employee_count: null,
  employee_range: null,
  founded_year: null,
  funding_stage: null,
  funding_amount: null,
  funding_year: null,
  emails: [],
  phones: [],
  socials: {},
  people: [],
  technologies: [],
  contact_form_url: null,
  provenance: {},
  score: 50,
  score_breakdown: {},
  match_reason: null,
  merged_into: null,
  merged_domains: [],
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

describe("cross-domain dedupe", () => {
  it("merges two domains sharing an email address", () => {
    const plans = planDedupe([
      row({ id: "a", domain: "acme.de", emails: ["info@acme.de"], score: 80 }),
      row({ id: "b", domain: "acme.com", emails: ["info@acme.de"], score: 60 }),
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.survivor.domain).toBe("acme.de");
    expect(plans[0]?.absorbedDomains).toEqual(["acme.com"]);
  });

  it("merges on company name when no email overlaps", () => {
    const plans = planDedupe([
      row({ id: "a", domain: "acme.de", company_name: "Acme AI GmbH", score: 80 }),
      row({ id: "b", domain: "acme.com", company_name: "Acme A.I. Inc", score: 70 }),
    ]);
    expect(plans).toHaveLength(1);
  });

  it("keeps unrelated companies apart", () => {
    const plans = planDedupe([
      row({ id: "a", domain: "acme.de", company_name: "Acme Robotics", emails: ["info@acme.de"] }),
      row({ id: "b", domain: "nordlicht.de", company_name: "Nordlicht AI", emails: ["info@nordlicht.de"] }),
    ]);
    expect(plans).toHaveLength(2);
  });

  // Discovery order must not decide which record ships.
  it("keeps the higher-scoring lead regardless of input order", () => {
    const high = row({ id: "a", domain: "acme.de", emails: ["info@acme.de"], score: 90 });
    const low = row({ id: "b", domain: "acme.com", emails: ["info@acme.de"], score: 20 });
    expect(planDedupe([low, high])[0]?.survivor.domain).toBe("acme.de");
    expect(planDedupe([high, low])[0]?.survivor.domain).toBe("acme.de");
  });

  it("takes contact fields the survivor was missing without overwriting its own", () => {
    const plans = planDedupe([
      row({ id: "a", domain: "acme.de", emails: ["info@acme.de"], score: 80, city: "Berlin" }),
      row({
        id: "b",
        domain: "acme.com",
        emails: ["info@acme.de", "sales@acme.com"],
        phones: ["+493012345678"],
        score: 60,
        city: "Munich",
      }),
    ]);
    const s = plans[0]!.survivor;
    expect(s.emails).toEqual(["info@acme.de", "sales@acme.com"]);
    expect(s.phones).toEqual(["+493012345678"]);
    expect(s.city).toBe("Berlin");
  });

  // A record must never cite a source for a value it is not showing.
  it("does not overwrite provenance for a field the survivor already had", () => {
    const plans = planDedupe([
      row({
        id: "a",
        domain: "acme.de",
        emails: ["info@acme.de"],
        score: 80,
        company_name: "Acme AI GmbH",
        provenance: { company_name: { source_url: "https://acme.de/", method: "jsonld", confidence: 0.95 } },
      }),
      row({
        id: "b",
        domain: "acme.com",
        emails: ["info@acme.de"],
        score: 60,
        company_name: "Acme AI GmbH",
        provenance: { company_name: { source_url: "https://acme.com/", method: "llm", confidence: 0.7 } },
      }),
    ]);
    expect(plans[0]?.survivor.provenance.company_name?.method).toBe("jsonld");
  });
});
