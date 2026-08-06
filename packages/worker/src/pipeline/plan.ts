import type { AIMessage } from "@langchain/core/messages";
import { PlanSchema, type Plan } from "@lead/core";
import { config } from "../config.js";
import { NO_USAGE, readUsage, type TokenUsage } from "../llm/client.js";
import { chatModel, structuredOutputMethod } from "../llm/provider.js";

/**
 * Turn the user's natural-language query into a structured plan.
 *
 * This runs once per run, before any spend, and its output is what the human
 * approval gate shows. Getting the requirements wrong here wastes the entire
 * run's scraping budget, which is why this role gets the stronger model tier
 * while per-domain extraction gets the cheap one.
 */

const SYSTEM_INSTRUCTIONS = `You plan B2B lead-generation runs. Given a natural-language query describing companies the user wants to find, you produce a structured plan that a scraping pipeline will execute.

## Requirements

Translate the query into the requirements schema literally. Do not add constraints the user did not state, and do not soften ones they did.

- Leave a field null when the query does not constrain it. A null employee_max means "no upper bound", not "unknown" — inventing bounds silently discards valid companies.
- countries takes ISO country names ("Germany", not "DE" or "German").
- keywords are terms you would expect to appear in the site copy of a matching company. Draw them from the query's domain vocabulary, not from generic business language.
- exclusions are terms that disqualify a company. Infer the obvious ones: a query for product companies should exclude consultancies and agencies, since those dominate results for most industry searches and are never the intended target.
- "recently" and "in the last N years" become funding_since_year. Compute it from the current year given below rather than guessing.

## Search queries

Produce 6-12 web search queries. They are run against a general web search API, and their only job is to surface company websites.

Diversity is what makes this work. Queries that differ only by word order return the same results and waste credits. Vary the angle instead:

- Direct descriptive phrasing of the ICP
- The industry vocabulary a matching company would use about itself
- Funding-announcement phrasing, when funding is a requirement, since round announcements name companies that marketing pages do not
- Regional and language-native phrasing when the query targets a non-English market — a German-market query should include German-language variants, because German companies describe themselves in German
- Adjacent framings: what such a company sells, who it sells to, the problem it solves

Do not write queries that target directory or aggregator sites. Those return listings the pipeline cannot scrape, not company domains.

## Target domains

Set target_domains to the number of distinct company websites worth scraping. Scale it to how specific the query is: a narrow query has a small real population and asking for 500 domains just pulls in non-matches. 50-150 suits most queries.

## Notes

State what could go wrong before the user approves spend: requirements unlikely to be verifiable from public websites, a market where the data is thin, an ambiguity you resolved by choosing one reading. This is the last checkpoint before the run costs money, so surface the caveat rather than the reassurance.`;

export type PlanOutcome = "ok" | "no_output" | "error";

export interface PlanResult {
  outcome: PlanOutcome;
  plan: Plan | null;
  usage: TokenUsage;
  error: string | null;
}

export async function planRun(query: string, currentYear: number): Promise<PlanResult> {
  try {
    const structured = chatModel("plan").withStructuredOutput(PlanSchema, {
      method: structuredOutputMethod(config.llmProvider),
      name: "plan",
      includeRaw: true,
    });

    const response = (await structured.invoke([
      {
        role: "system",
        content: `${SYSTEM_INSTRUCTIONS}\n\nThe current year is ${currentYear}.`,
      },
      { role: "user", content: `Plan a lead-generation run for this query:\n\n${query}` },
    ])) as { raw: AIMessage; parsed: Plan | null };

    const usage = readUsage(response.raw);
    if (!response.parsed) {
      return { outcome: "no_output", plan: null, usage, error: "model returned no parseable plan" };
    }
    return { outcome: "ok", plan: response.parsed, usage, error: null };
  } catch (err) {
    return {
      outcome: "error",
      plan: null,
      usage: NO_USAGE,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
