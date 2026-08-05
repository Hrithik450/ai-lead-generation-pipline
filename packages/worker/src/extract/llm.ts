import type { AIMessage } from "@langchain/core/messages";
import { CompanySchema, type Company, type Requirements } from "@lead/core";
import { config } from "../config.js";
import { NO_USAGE, readUsage, type TokenUsage } from "../llm/client.js";
import { chatModel, structuredOutputMethod } from "../llm/provider.js";
import { packDomainText, type PageText } from "./pack.js";

/**
 * One LLM call per domain — never per page.
 *
 * Deterministic extraction already produced the contact fields. What remains is
 * exactly what lives in prose and nowhere else: headcount, founding year, funding
 * stage/amount/year, and the match verdict against the run's requirements. Those
 * are the fields the user's query filters on, so this call happens for nearly
 * every domain. Making it *one* call over concatenated page text is the entire
 * cost optimization; per-page calls would multiply spend by the page budget for
 * no gain, since no single page holds the whole picture anyway.
 */

/** Token budget for the volatile page text. Leaves headroom under the ~8k input target. */
const TEXT_BUDGET_TOKENS = 7_000;

const SYSTEM_INSTRUCTIONS = `You extract company firmographics from scraped website text for a B2B lead-generation pipeline.

You will receive the cleaned text of several pages from a single company website, each preceded by a header naming its kind and URL. Your job is to return one structured record describing that company.

## Grounding rules

Every value you emit must be supported by the supplied text. This is the only rule that matters; the rest of this prompt elaborates on it.

- Never infer a value from the domain name, the company's industry, or general knowledge you may have about the company. If the text does not state it, the field is null.
- Never estimate. "A growing team" is not an employee count. "Recently funded" is not a funding year. "One of the leading providers" is not a headcount signal.
- Prefer the most specific page. A legal imprint page (Impressum, mentions légales) states the registered name and address authoritatively; an about page states founding history; a homepage states positioning. When two pages conflict, trust the more formal one and reflect the uncertainty in your confidence score.
- Text may be in any language. Extract into the schema regardless; keep proper nouns, addresses, and funding figures in their original form and language. Do not translate a company's legal name.

## Field-specific guidance

**company_name** — The trading or legal name. Strip taglines and page-title suffixes. Keep legal-form suffixes when the site uses them (GmbH, BV, AB, Oy, SAS, Ltd, Inc), since they carry jurisdiction information.

**description** — One or two sentences on what the company actually does, in your own words, drawn from the text. Not marketing copy verbatim, and not a restatement of the industry field.

**industry** — A short noun phrase ("computer vision for logistics", "dental practice software"). Not a broad sector label unless the site offers nothing narrower.

**country / city / address** — From the imprint or contact text. Use the ISO country name. If only a city appears, leave country null rather than inferring it — a city name is not always unambiguous, and a wrong country silently corrupts geographic filtering.

**employee_count** — Only when the text states a number of people ("our team of 34", "we are 120 engineers"). A LinkedIn-style range on the page is not an exact count.

**employee_range** — When the text gives a band rather than a number ("20-50 employees", "a team of under 10"), record the band here as written and leave employee_count null. Do not populate both from the same statement.

**founded_year** — Only from an explicit statement: "founded in 2019", "gegründet 2021", "since 2004", or an imprint registration year. A copyright year is not a founding year.

**funding_stage / funding_amount / funding_year** — Only from explicit funding statements: a press release, a news item, an investor list with a round named. "Backed by" without a round is a funding signal but not a stage — leave funding_stage null and note it in match_reason. Record funding_amount exactly as written, including currency and unit ("€3.5 Mio.", "$4.2M", "SEK 40 million"), because normalizing loses the currency.

**emails / phones** — Only addresses and numbers that appear literally in the text. Do not construct info@ or hello@ addresses from the domain. Omit anything that looks like a template placeholder or an image filename.

**people** — Named individuals with a role at the company: founders, executives, managing directors (Geschäftsführer). Include a person only when the text names them and their role. Leave their email null unless the text pairs an address with that specific person.

**technologies** — Concrete named technologies the company builds with or sells, when the site names them. Not generic categories like "AI" or "cloud".

**socials** — Only profile URLs present in the text.

## The match verdict

**matches_requirements** — Judge the company against the requirements block in this prompt, using only the extracted evidence.

Treat an unverifiable requirement as unmet. If the requirements demand 20-100 employees and the site never states headcount, the company does not demonstrably match — set false and say so in match_reason. This pipeline surfaces leads a human will act on, so a confident false positive costs far more than a miss: it sends someone to a company that was never a fit.

**match_reason** — One or two sentences citing the specific evidence behind the verdict, including which requirement failed or could not be verified. This is what a reviewer reads instead of re-opening the site, so name the fact, not the conclusion.

**confidence** — Your confidence in the extracted firmographics as a whole, not in the match verdict. Full imprint plus about page with explicit numbers is high. A homepage of marketing copy with no concrete facts is low, even when the extraction is technically correct.

Return null for any field the text does not support. A sparse, accurate record is useful; a complete, invented one poisons the dataset.`;

export type LlmExtractionOutcome = "ok" | "no_output" | "no_input" | "error";

export interface LlmExtraction {
  outcome: LlmExtractionOutcome;
  company: Company | null;
  usage: TokenUsage;
  pagesIncluded: number;
  pagesDropped: number;
  estimatedInputTokens: number;
  error: string | null;
}

export async function extractWithLlm(
  pages: PageText[],
  requirements: Requirements,
  hints: { domain: string; deterministicName: string | null },
): Promise<LlmExtraction> {
  const packed = packDomainText(pages, TEXT_BUDGET_TOKENS);
  const base = {
    usage: NO_USAGE,
    pagesIncluded: packed.pagesIncluded,
    pagesDropped: packed.pagesDropped,
    estimatedInputTokens: packed.estimatedTokens,
  };

  if (packed.text.length < 200) {
    return { ...base, outcome: "no_input", company: null, error: "no usable page text" };
  }

  try {
    // Instructions and requirements lead the prompt and are byte-identical for
    // every domain in a run, which is the layout providers with implicit prefix
    // caching want. It does not currently engage on Gemini: the prefix is ~1.5k
    // tokens and Gemini's implicit cache has a 4096-token minimum, so every
    // request is billed in full. Left this way deliberately — padding the prompt
    // to reach the threshold would cost more than the cache saves. The layout is
    // what matters if the prompt grows or the provider changes.
    //
    // Both must go in ONE system message: Gemini rejects a system message at any
    // index but 0, so a second one throws before the request is ever sent.
    const structured = chatModel("extract").withStructuredOutput(CompanySchema, {
      method: structuredOutputMethod(config.llmProvider),
      name: "company",
      includeRaw: true,
    });

    const response = (await structured.invoke([
      {
        role: "system",
        content: `${SYSTEM_INSTRUCTIONS}\n\n## Run requirements\n\n${JSON.stringify(requirements, null, 2)}`,
      },
      { role: "user", content: buildUserPrompt(hints, packed.text) },
    ])) as { raw: AIMessage; parsed: Company | null };

    const usage = readUsage(response.raw);
    const company = response.parsed;

    if (!company) {
      return {
        ...base,
        usage,
        outcome: "no_output",
        company: null,
        error: "model returned no parseable output",
      };
    }

    return { ...base, usage, outcome: "ok", company, error: null };
  } catch (err) {
    return {
      ...base,
      outcome: "error",
      company: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildUserPrompt(
  hints: { domain: string; deterministicName: string | null },
  text: string,
): string {
  const nameHint = hints.deterministicName
    ? `\nName found in the page markup: ${hints.deterministicName}`
    : "";
  return `Company website: ${hints.domain}${nameHint}\n\nPage text follows.\n${text}`;
}
