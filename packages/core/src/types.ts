import { z } from "zod";

// --- Run requirements: the structured form of the user's natural-language query. ---

export const RequirementsSchema = z.object({
  industry: z.string().nullable().describe("Industry or vertical, e.g. 'AI startups'"),
  countries: z.array(z.string()).describe("ISO country names the company must operate in"),
  cities: z.array(z.string()).describe("Cities, if the query narrows further than country"),
  employee_min: z.number().int().nullable(),
  employee_max: z.number().int().nullable(),
  founded_after: z.number().int().nullable().describe("Earliest founding year, if constrained"),
  funding_required: z.boolean().describe("True if the query demands the company has raised funding"),
  funding_since_year: z.number().int().nullable().describe("Funding must have occurred at or after this year"),
  keywords: z.array(z.string()).describe("Distinguishing terms to look for in site copy"),
  exclusions: z.array(z.string()).describe("Terms that disqualify a company"),
});

export type Requirements = z.infer<typeof RequirementsSchema>;

export const PlanSchema = z.object({
  interpretation: z.string().describe("One-sentence restatement of what the user is asking for"),
  requirements: RequirementsSchema,
  search_queries: z
    .array(z.string())
    .describe("6-12 diverse web search queries that surface companies matching the requirements"),
  target_domains: z
    .number()
    .int()
    .describe("How many distinct company domains to scrape for this run"),
  notes: z.string().describe("Caveats, coverage gaps, or assumptions worth surfacing before spend begins"),
});

export type Plan = z.infer<typeof PlanSchema>;

// --- Company extraction: what the LLM returns for one domain. ---

export const PersonSchema = z.object({
  name: z.string(),
  role: z.string().nullable(),
  email: z.string().nullable(),
  linkedin: z.string().nullable(),
});

export const CompanySchema = z.object({
  company_name: z.string().nullable(),
  description: z.string().nullable().describe("One or two sentences on what the company does"),
  industry: z.string().nullable(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  address: z.string().nullable(),
  employee_count: z.number().int().nullable().describe("Only if explicitly stated on the site"),
  employee_range: z.string().nullable().describe("e.g. '20-50' when a range but no exact count is given"),
  founded_year: z.number().int().nullable(),
  funding_stage: z.string().nullable().describe("e.g. 'Seed', 'Series A'"),
  funding_amount: z.string().nullable().describe("As written, e.g. '$4.2M', '€3 Mio.'"),
  funding_year: z.number().int().nullable(),
  emails: z.array(z.string()),
  phones: z.array(z.string()),
  people: z.array(PersonSchema),
  technologies: z.array(z.string()),
  socials: z.object({
    linkedin: z.string().nullable(),
    twitter: z.string().nullable(),
    github: z.string().nullable(),
    facebook: z.string().nullable(),
  }),
  matches_requirements: z.boolean().describe("Whether this company satisfies the stated requirements"),
  match_reason: z.string().describe("Short justification for the match verdict, citing site evidence"),
  confidence: z.number().min(0).max(1).describe("Confidence in the extracted firmographics overall"),
});

export type Company = z.infer<typeof CompanySchema>;
export type Person = z.infer<typeof PersonSchema>;

// --- Provenance ---

export type ProvenanceMethod =
  | "jsonld"
  | "microdata"
  | "opengraph"
  | "meta"
  | "mailto"
  | "tel"
  | "regex"
  | "cfemail"
  | "llm"
  | "hunter"
  | "search";

export interface ProvenanceEntry {
  source_url: string;
  method: ProvenanceMethod;
  confidence: number;
}

export type Provenance = Record<string, ProvenanceEntry>;

// --- Persisted shapes ---

export type RunStatus =
  | "planning"
  | "awaiting_approval"
  | "discovering"
  | "scraping"
  | "completed"
  | "failed"
  | "cancelled";

export type DomainStatus =
  | "queued"
  | "fetching"
  | "extracting"
  | "done"
  | "failed"
  | "blocked"
  | "skipped";

export type DomainOutcome =
  | "ok"
  | "blocked"
  | "robots_disallowed"
  | "no_contact"
  | "form_only"
  | "unreachable";

export type PageKind = "home" | "about" | "team" | "contact" | "imprint" | "careers" | "other";

export interface RunRow {
  id: string;
  query: string;
  status: RunStatus;
  plan: Plan | null;
  requirements: Requirements | null;
  error: string | null;
  domains_total: number;
  domains_done: number;
  domains_failed: number;
  pages_fetched: number;
  tier1_pages: number;
  tier2_pages: number;
  llm_input_tokens: number;
  llm_output_tokens: number;
  llm_cached_tokens: number;
  created_at: string;
  approved_at: string | null;
  finished_at: string | null;
}

export interface DomainRow {
  id: string;
  run_id: string;
  domain: string;
  seed_url: string;
  source: string;
  status: DomainStatus;
  outcome: DomainOutcome | null;
  note: string | null;
  pages: number;
  max_tier: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface LeadRow {
  id: string;
  run_id: string;
  domain_id: string;
  domain: string;
  company_name: string | null;
  website: string | null;
  description: string | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  employee_count: number | null;
  employee_range: string | null;
  founded_year: number | null;
  funding_stage: string | null;
  funding_amount: string | null;
  funding_year: number | null;
  emails: string[];
  phones: string[];
  socials: Record<string, string | null>;
  people: Person[];
  technologies: string[];
  contact_form_url: string | null;
  provenance: Provenance;
  score: number;
  score_breakdown: Record<string, number>;
  match_reason: string | null;
  /** Set when dedupe folded this lead into another; such rows are excluded from exports. */
  merged_into: string | null;
  merged_domains: string[];
  created_at: string;
}

export interface RunEventRow {
  id: number;
  run_id: string;
  level: "info" | "warn" | "error";
  stage: string;
  message: string;
  data: unknown;
  created_at: string;
}
