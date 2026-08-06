import type { DomainOutcome, PageKind, Requirements } from "@lead/core";
import { config } from "../config.js";
import { extractDeterministic, type DeterministicResult } from "../extract/deterministic.js";
import { extractWithLlm } from "../extract/llm.js";
import { selectPages } from "../extract/link-discovery.js";
import { mergeExtraction, type MergedLead } from "../extract/merge.js";
import type { PageText } from "../extract/pack.js";
import { fetchPage, type FetchResult } from "../fetch/tiered-fetcher.js";
import { NO_USAGE, type TokenUsage } from "../llm/client.js";

/**
 * Process one domain end to end.
 *
 * The unit of work is the domain, not the URL — that is what lets per-host
 * politeness stay local to a single job instead of needing a distributed rate
 * limiter, and it is what makes one LLM call per domain natural rather than
 * bolted on.
 */

export interface DomainResult {
  domain: string;
  outcome: DomainOutcome;
  note: string | null;
  lead: MergedLead | null;
  pages: PageRecord[];
  maxTier: 0 | 1 | 2;
  usage: TokenUsage;
  /** Stopped at a checkpoint rather than reaching a verdict. Not a failure. */
  cancelled: boolean;
}

export interface PageRecord {
  url: string;
  finalUrl: string;
  kind: PageKind;
  tier: 0 | 1 | 2;
  statusCode: number | null;
  contentHash: string | null;
  escalationReason: string | null;
  error: string | null;
}

export interface DomainJobInput {
  domain: string;
  seedUrl: string;
  requirements: Requirements;
  /** Checked between pages so a cancelled run stops without killing the worker. */
  isCancelled?: () => Promise<boolean> | boolean;
}

export async function processDomain(input: DomainJobInput): Promise<DomainResult> {
  const { domain, seedUrl, requirements } = input;
  const pages: PageRecord[] = [];
  const det: DeterministicResult[] = [];
  const pageTexts: PageText[] = [];
  let maxTier: 0 | 1 | 2 = 0;

  const visit = async (url: string, kind: PageKind): Promise<FetchResult> => {
    const res = await fetchPage(url);
    if (res.tier > maxTier) maxTier = res.tier;
    pages.push({
      url: res.url,
      finalUrl: res.finalUrl,
      kind,
      tier: res.tier,
      statusCode: res.statusCode,
      contentHash: res.contentHash,
      escalationReason: res.escalationReason,
      error: res.error,
    });
    if (res.outcome === "ok" && res.html) {
      const extracted = extractDeterministic(res.html, res.finalUrl, kind);
      det.push(extracted);
      pageTexts.push({ url: res.finalUrl, kind, text: extracted.cleanText });
    }
    return res;
  };

  const home = await visit(seedUrl, "home");
  if (home.outcome !== "ok") {
    return {
      domain,
      outcome: fetchOutcomeToDomainOutcome(home),
      note: home.error ?? home.escalationReason,
      lead: null,
      pages,
      maxTier,
      usage: NO_USAGE,
      cancelled: false,
    };
  }

  // Discover follow-up pages from the homepage's own navigation rather than
  // guessing paths — /ueber-uns and /impressum are invisible to path guessing.
  const budget = Math.max(0, config.maxPagesPerDomain - 1);
  let cancelled = false;
  for (const link of selectPages(det[0]?.links ?? [], budget)) {
    if (await input.isCancelled?.()) {
      cancelled = true;
      break;
    }
    await visit(link.url, link.kind);
  }

  // The LLM call is the one irreversible cost in this job, so the last checkpoint
  // sits directly in front of it. Stopping after the fetches but before the spend
  // is the whole point of cancelling a run that is already under way.
  if (cancelled || (await input.isCancelled?.())) {
    return {
      domain,
      outcome: "unreachable",
      note: "cancelled",
      lead: null,
      pages,
      maxTier,
      usage: NO_USAGE,
      cancelled: true,
    };
  }

  const llm = await extractWithLlm(pageTexts, requirements, {
    domain,
    deterministicName: det.find((d) => d.companyName)?.companyName ?? null,
  });

  const lead = mergeExtraction(domain, home.finalUrl, det, llm.company);

  return {
    domain,
    outcome: classifyOutcome(lead, det),
    note: llm.outcome === "ok" ? null : llm.error,
    lead,
    pages,
    maxTier,
    usage: llm.usage,
    cancelled: false,
  };
}

function fetchOutcomeToDomainOutcome(res: FetchResult): DomainOutcome {
  switch (res.outcome) {
    case "blocked":
      return "blocked";
    case "robots_disallowed":
      return "robots_disallowed";
    default:
      return "unreachable";
  }
}

/**
 * "Reachable only through a contact form" is a real, actionable state — someone
 * can still be contacted. Collapsing it into "no contact found" would tell the
 * scorer to discard a lead that is merely inconvenient to reach.
 */
function classifyOutcome(lead: MergedLead, det: DeterministicResult[]): DomainOutcome {
  if (lead.emails.length > 0 || lead.phones.length > 0) return "ok";
  if (det.some((d) => d.formOnlyContact)) return "form_only";
  return "no_contact";
}
