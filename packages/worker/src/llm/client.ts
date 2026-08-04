import type { AIMessage } from "@langchain/core/messages";

/**
 * Token accounting, normalized across providers.
 *
 * LangChain maps every vendor's usage payload onto `usage_metadata`, so the same
 * counters work whether the run used Gemini, GPT, or Claude. Cache hits live in
 * `input_token_details` and are reported separately by every provider that
 * supports caching.
 */

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const NO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function readUsage(message: AIMessage | undefined): TokenUsage {
  const usage = message?.usage_metadata;
  if (!usage) return NO_USAGE;
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.input_token_details?.cache_read ?? 0,
    cacheWrite: usage.input_token_details?.cache_creation ?? 0,
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/**
 * Character-based token estimate.
 *
 * The alternative is a token-counting call, which would double the request count
 * for every domain to enforce a budget that only needs to be approximately right.
 * English and German web copy runs ~3.6-4.2 chars/token; 3.6 keeps the estimate
 * conservative so the real input stays under the cap.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}
