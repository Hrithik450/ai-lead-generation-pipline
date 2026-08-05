import type { PageKind } from "@lead/core";
import { estimateTokens } from "../llm/client.js";

export interface PageText {
  url: string;
  kind: PageKind;
  text: string;
}

/**
 * Order pages by how much firmographic signal they carry per token.
 *
 * The imprint wins on German sites (TMG §5 forces legal name, address, contact
 * into one page), about/team carry founding year and headcount, careers is a
 * decent headcount proxy, and the homepage carries positioning. Contact pages
 * rank low here on purpose: deterministic extraction already took everything
 * useful off them, so spending the LLM budget there buys nothing.
 */
const KIND_RANK: Record<PageKind, number> = {
  imprint: 0,
  about: 1,
  home: 2,
  team: 3,
  careers: 4,
  contact: 5,
  other: 6,
};

/** Per-page cap, so one bloated page cannot consume the whole budget. */
const PER_PAGE_TOKEN_CAP = 3_000;

export interface PackedInput {
  text: string;
  pagesIncluded: number;
  pagesDropped: number;
  estimatedTokens: number;
}

/**
 * Concatenate cleaned page text into one LLM input under a token budget.
 *
 * One call per domain is the cost model, so this is where the domain's whole
 * evidence set has to fit. Pages are added highest-signal first and the tail is
 * dropped rather than truncated mid-page — a half sentence invites the model to
 * guess at what was cut off.
 */
export function packDomainText(pages: PageText[], budgetTokens: number): PackedInput {
  const ordered = [...pages]
    .filter((p) => p.text.trim().length > 0)
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);

  const chunks: string[] = [];
  let used = 0;
  let included = 0;

  for (const page of ordered) {
    const body = clampToTokens(collapse(page.text), PER_PAGE_TOKEN_CAP);
    const header = `\n=== ${page.kind.toUpperCase()} — ${page.url} ===\n`;
    const cost = estimateTokens(header + body);
    if (used + cost > budgetTokens && included > 0) break;
    chunks.push(header + body);
    used += cost;
    included += 1;
  }

  return {
    text: chunks.join("\n").trim(),
    pagesIncluded: included,
    pagesDropped: ordered.length - included,
    estimatedTokens: used,
  };
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clampToTokens(text: string, maxTokens: number): string {
  const maxChars = Math.floor(maxTokens * 3.6);
  if (text.length <= maxChars) return text;
  // Cut at a sentence boundary inside the last 15% so the tail reads as finished.
  const slice = text.slice(0, maxChars);
  const boundary = slice.lastIndexOf(". ");
  return boundary > maxChars * 0.85 ? slice.slice(0, boundary + 1) : slice;
}
