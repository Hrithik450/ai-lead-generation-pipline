import { Redis } from "ioredis";
import { config } from "../config.js";

/**
 * Run counters and the cancel flag, both in Redis.
 *
 * Counters are here rather than in Postgres because `UPDATE runs SET done = done + 1`
 * from N concurrent workers serializes every one of them on a single row lock —
 * with 4+ workers that lock, not the scraping, becomes the bottleneck. Redis
 * HINCRBY is atomic and uncontended; Postgres gets one absolute write when the
 * run ends (and periodically, so a crash loses progress display, not data).
 */

let client: Redis | undefined;

export function redis(): Redis {
  if (!client) {
    // BullMQ requires this; ioredis defaults to 20 and then throws mid-run.
    client = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  await client?.quit();
  client = undefined;
}

export interface RunCounters {
  domains_done: number;
  domains_failed: number;
  pages_fetched: number;
  tier1_pages: number;
  tier2_pages: number;
  llm_input_tokens: number;
  llm_output_tokens: number;
  llm_cached_tokens: number;
}

export type CounterField = keyof RunCounters;

const ZERO: RunCounters = {
  domains_done: 0,
  domains_failed: 0,
  pages_fetched: 0,
  tier1_pages: 0,
  tier2_pages: 0,
  llm_input_tokens: 0,
  llm_output_tokens: 0,
  llm_cached_tokens: 0,
};

/** Counters outlive the run only long enough for the UI to read the final state. */
const COUNTER_TTL_SECONDS = 24 * 60 * 60;

const countersKey = (runId: string): string => `run:${runId}:counters`;
const cancelKey = (runId: string): string => `run:${runId}:cancelled`;

export async function bumpCounters(
  runId: string,
  deltas: Partial<RunCounters>,
): Promise<void> {
  const entries = Object.entries(deltas).filter(([, v]) => v);
  if (entries.length === 0) return;

  const key = countersKey(runId);
  const pipeline = redis().pipeline();
  for (const [field, delta] of entries) pipeline.hincrby(key, field, delta as number);
  pipeline.expire(key, COUNTER_TTL_SECONDS);
  await pipeline.exec();
}

export async function readCounters(runId: string): Promise<RunCounters> {
  const raw = await redis().hgetall(countersKey(runId));
  const out = { ...ZERO };
  for (const field of Object.keys(ZERO) as CounterField[]) {
    const v = raw[field];
    if (v) out[field] = Number(v);
  }
  return out;
}

export async function clearCounters(runId: string): Promise<void> {
  await redis().del(countersKey(runId));
}

/**
 * The cancel flag is set once and read between pages by every in-flight domain
 * job. It has no TTL tied to the run's lifetime on purpose: a job that started
 * before the cancel must still see the flag when it reaches its next checkpoint.
 */
export async function markCancelled(runId: string): Promise<void> {
  await redis().set(cancelKey(runId), "1", "EX", COUNTER_TTL_SECONDS);
}

export async function isCancelled(runId: string): Promise<boolean> {
  return (await redis().exists(cancelKey(runId))) === 1;
}
