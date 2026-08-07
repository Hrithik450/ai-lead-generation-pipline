import { describe, expect, it } from "vitest";
import { packDomainText, type PageText } from "../src/extract/pack.js";
import { mergeExtraction } from "../src/extract/merge.js";
import type { DeterministicResult } from "../src/extract/deterministic.js";
import type { Company } from "@lead/core";

function page(kind: PageText["kind"], text: string, url = `https://a.de/${kind}`): PageText {
  return { kind, url, text };
}

function det(over: Partial<DeterministicResult>): DeterministicResult {
  return {
    sourceUrl: "https://a.de/",
    kind: "home",
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
    ...over,
  };
}

function company(over: Partial<Company>): Company {
  return {
    company_name: null,
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
    people: [],
    technologies: [],
    socials: { linkedin: null, twitter: null, github: null, facebook: null },
    matches_requirements: false,
    match_reason: "",
    confidence: 0.5,
    ...over,
  };
}

describe("packing domain text for a single LLM call", () => {
  it("orders the imprint ahead of the homepage", () => {
    const packed = packDomainText(
      [page("home", "homepage copy ".repeat(20)), page("imprint", "Impressum body ".repeat(20))],
      10_000,
    );
    expect(packed.text.indexOf("IMPRINT")).toBeLessThan(packed.text.indexOf("HOME"));
  });

  it("ranks contact pages last — deterministic extraction already took what mattered", () => {
    const packed = packDomainText(
      [page("contact", "contact copy ".repeat(20)), page("about", "about copy ".repeat(20))],
      10_000,
    );
    expect(packed.text.indexOf("ABOUT")).toBeLessThan(packed.text.indexOf("CONTACT"));
  });

  it("drops whole low-priority pages rather than truncating mid-sentence", () => {
    const big = "Sentence about the company. ".repeat(400);
    const packed = packDomainText(
      [page("imprint", big), page("about", big), page("careers", big), page("contact", big)],
      2_000,
    );
    expect(packed.pagesIncluded).toBe(1);
    expect(packed.pagesDropped).toBe(3);
    expect(packed.text).toContain("IMPRINT");
    expect(packed.text).not.toContain("CONTACT");
  });

  it("always includes at least one page even when it alone exceeds the budget", () => {
    const packed = packDomainText([page("home", "x ".repeat(50_000))], 100);
    expect(packed.pagesIncluded).toBe(1);
  });

  it("skips empty pages so a failed render does not occupy a slot", () => {
    const packed = packDomainText([page("home", "   "), page("about", "real copy")], 10_000);
    expect(packed.pagesIncluded).toBe(1);
    expect(packed.text).toContain("ABOUT");
  });
});

describe("merging deterministic and LLM extraction", () => {
  it("prefers the parsed email over the LLM's, which passed through a paraphrase", () => {
    const merged = mergeExtraction(
      "a.de",
      "https://a.de/",
      [det({ emails: [{ value: "info@a.de", method: "mailto", sourceUrl: "https://a.de/kontakt" }] })],
      company({ emails: ["1nfo@a.de"] }),
    );
    expect(merged.emails).toEqual(["info@a.de"]);
    expect(merged.provenance["email:info@a.de"]?.method).toBe("mailto");
  });

  it("never adopts emails the LLM produced on its own", () => {
    const merged = mergeExtraction("a.de", "https://a.de/", [det({})], company({ emails: ["hello@a.de"] }));
    expect(merged.emails).toEqual([]);
  });

  it("takes headcount and funding from the LLM — no parser can reach them", () => {
    const merged = mergeExtraction(
      "a.de",
      "https://a.de/",
      [det({ companyName: "Nordlicht AI GmbH" })],
      company({ employee_count: 34, funding_stage: "Seed", funding_amount: "€3,5 Mio.", funding_year: 2024 }),
    );
    expect(merged.employeeCount).toBe(34);
    expect(merged.fundingAmount).toBe("€3,5 Mio.");
    expect(merged.provenance["employee_count"]?.method).toBe("llm");
    expect(merged.provenance["company_name"]?.method).not.toBe("llm");
  });

  it("records a source URL and method for every populated field", () => {
    const merged = mergeExtraction(
      "a.de",
      "https://a.de/",
      [det({ sourceUrl: "https://a.de/impressum", companyName: "Nordlicht AI GmbH", city: "Hamburg" })],
      company({ industry: "computer vision" }),
    );
    for (const field of ["company_name", "city", "industry"]) {
      expect(merged.provenance[field]?.source_url).toBeTruthy();
      expect(merged.provenance[field]?.method).toBeTruthy();
    }
    expect(merged.provenance["city"]?.source_url).toBe("https://a.de/impressum");
  });

  it("treats a missing LLM result as unmatched rather than defaulting to a match", () => {
    const merged = mergeExtraction("a.de", "https://a.de/", [det({ companyName: "Acme" })], null);
    expect(merged.matchesRequirements).toBe(false);
    expect(merged.llmConfidence).toBe(0);
    expect(merged.matchReason).toContain("no LLM extraction");
  });

  it("fills a social profile from the LLM only when the parser found none", () => {
    const merged = mergeExtraction(
      "a.de",
      "https://a.de/",
      [det({ socials: { linkedin: "https://linkedin.com/company/real" } })],
      company({
        socials: {
          linkedin: "https://linkedin.com/company/hallucinated",
          github: "https://github.com/real",
          twitter: null,
          facebook: null,
        },
      }),
    );
    expect(merged.socials.linkedin).toBe("https://linkedin.com/company/real");
    expect(merged.socials.github).toBe("https://github.com/real");
    expect(merged.provenance["social:github"]?.method).toBe("llm");
  });

  it("dedupes people by name across pages", () => {
    const merged = mergeExtraction(
      "a.de",
      "https://a.de/",
      [det({})],
      company({
        people: [
          { name: "Lena Brandt", role: "CEO", email: null, linkedin: null },
          { name: "lena brandt", role: "Geschäftsführerin", email: null, linkedin: null },
        ],
      }),
    );
    expect(merged.people).toHaveLength(1);
  });
});
