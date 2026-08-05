import { Queue } from "bullmq";
import type { Requirements } from "@lead/core";
import { redis } from "./counters.js";

/**
 * One job per domain — never per URL.
 *
 * A domain job owns its whole host budget locally, so per-host politeness is a
 * local token bucket instead of a distributed rate limiter. It is also what makes
 * one LLM call per domain natural: the job already holds every page it fetched.
 */

export const DOMAIN_QUEUE = "domains";

export interface DomainJobData {
  runId: string;
  domainId: string;
  domain: string;
  seedUrl: string;
  requirements: Requirements;
}

/** Jobs return an id, never a payload — BullMQ stores return values in Redis. */
export interface DomainJobResult {
  domainId: string;
}

let queue: Queue<DomainJobData, DomainJobResult> | undefined;

export function domainQueue(): Queue<DomainJobData, DomainJobResult> {
  if (!queue) {
    queue = new Queue<DomainJobData, DomainJobResult>(DOMAIN_QUEUE, {
      connection: redis(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 5_000 },
        // Unbounded completed/failed sets are the standard way a BullMQ Redis
        // instance runs out of memory over a few large runs.
        removeOnComplete: { age: 24 * 60 * 60, count: 5_000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
      },
    });
  }
  return queue;
}

export async function closeQueue(): Promise<void> {
  await queue?.close();
  queue = undefined;
}

/**
 * Enqueue every domain for a run.
 *
 * `jobId` is derived from run + domain so re-enqueueing is idempotent: a retried
 * orchestrator, or two workers racing the same discovery result, cannot produce
 * duplicate scrapes of one domain.
 */
export async function enqueueDomains(jobs: DomainJobData[]): Promise<void> {
  if (jobs.length === 0) return;
  await domainQueue().addBulk(
    jobs.map((data) => ({
      name: "domain",
      data,
      opts: { jobId: `run:${data.runId}:${data.domain}` },
    })),
  );
}

/**
 * Remove not-yet-started jobs for a run.
 *
 * Only waiting and delayed jobs can be dropped this way. Jobs already executing
 * stop at their next cancel checkpoint instead — see the isCancelled call in the
 * domain worker.
 */
export async function drainRunJobs(runId: string): Promise<number> {
  const q = domainQueue();
  const pending = await q.getJobs(["waiting", "delayed", "prioritized"]);
  const prefix = `run:${runId}:`;
  let removed = 0;
  for (const job of pending) {
    if (job.id?.startsWith(prefix)) {
      await job.remove();
      removed += 1;
    }
  }
  return removed;
}
