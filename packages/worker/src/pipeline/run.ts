import {
  applyLeadMerge,
  flushRunCounters,
  getRun,
  insertDomains,
  listDomains,
  listShippableLeads,
  logEvent,
  setDomainsTotal,
  setRunStatus,
  skipQueuedDomains,
} from "@lead/core";
import type { Requirements } from "@lead/core";
import {
  clearCounters,
  isCancelled,
  markCancelled,
  readCounters,
} from "../queue/counters.js";
import { drainRunJobs, enqueueDomains } from "../queue/queue.js";
import { planDedupe } from "./dedupe.js";

/**
 * Run lifecycle.
 *
 * A run is a `runs` row plus Redis counters plus a cancel flag — deliberately not
 * a BullMQ Flow. Flows tie completion to a parent job, which means cancelling
 * means killing a parent whose children are mid-flight, and progress lives
 * somewhere neither the API nor the dashboard can cheaply read. A row and a
 * counter hash are legible from anywhere and survive a worker restart.
 */

export interface StartRunInput {
  runId: string;
  requirements: Requirements;
  domains: { domain: string; seedUrl: string; source: string }[];
}

export async function startRun(input: StartRunInput): Promise<number> {
  const { runId, requirements } = input;

  const rows = await insertDomains(
    runId,
    input.domains.map((d) => ({ domain: d.domain, seed_url: d.seedUrl, source: d.source })),
  );

  await setDomainsTotal(runId, rows.length);
  await setRunStatus(runId, "scraping");

  await enqueueDomains(
    rows.map((row) => ({
      runId,
      domainId: row.id,
      domain: row.domain,
      seedUrl: row.seed_url,
      requirements,
    })),
  );

  await logEvent(runId, "scrape", `enqueued ${rows.length} domains`);
  return rows.length;
}

/**
 * Cancel: set the flag first, then drain.
 *
 * Order matters. Draining first leaves a window where a worker picks up a job
 * that was still waiting and starts a fresh domain after the cancel was issued.
 * Setting the flag first means anything that starts in that window stops at its
 * first checkpoint.
 *
 * Dropping the jobs is only half of it — the domain rows they would have written
 * have to be closed out too, or the run keeps a set of permanently `queued`
 * domains and never reaches a terminal state.
 */
export async function cancelRun(runId: string): Promise<{ drained: number }> {
  await markCancelled(runId);
  const drained = await drainRunJobs(runId);
  await skipQueuedDomains(runId, "run cancelled before start");
  await flushCounters(runId);
  await setRunStatus(runId, "cancelled");
  await logEvent(runId, "cancel", `cancelled; ${drained} queued domains dropped`, {
    level: "warn",
  });
  return { drained };
}

/** Copy Redis counters into Postgres in one absolute write. */
export async function flushCounters(runId: string): Promise<void> {
  await flushRunCounters(runId, await readCounters(runId));
}

/**
 * Has every domain reached a terminal state?
 *
 * Derived from the domains table rather than from a counter, because the counter
 * is a display value that a crash can leave behind. The table is the truth.
 */
export async function isRunFinished(runId: string): Promise<boolean> {
  const domains = await listDomains(runId);
  if (domains.length === 0) return false;
  return domains.every(
    (d) =>
      d.status === "done" ||
      d.status === "failed" ||
      d.status === "blocked" ||
      d.status === "skipped",
  );
}

/**
 * Collapse duplicate companies across the run's domains.
 *
 * Runs once, at finalize, because it is the only point where every domain has a
 * lead to compare. Returns the number of leads folded away.
 *
 * Reads survivors only. Including already-absorbed rows would re-merge them on
 * every call, and finalize is explicitly safe to invoke repeatedly.
 */
export async function dedupeRunLeads(runId: string): Promise<number> {
  const leads = await listShippableLeads(runId);
  if (leads.length < 2) return 0;

  let merged = 0;
  for (const plan of planDedupe(leads)) {
    if (plan.absorbedIds.length === 0) continue;
    await applyLeadMerge(plan.survivor, plan.absorbedIds, plan.absorbedDomains);
    merged += plan.absorbedIds.length;
    await logEvent(
      runId,
      "dedupe",
      `${plan.survivor.domain} absorbed ${plan.absorbedDomains.join(", ")}`,
    );
  }
  return merged;
}

/**
 * Finalize a run once its domains are all terminal.
 *
 * Safe to call repeatedly — it no-ops unless every domain is done, so a periodic
 * sweep and an event-driven call can both invoke it without racing to a double
 * completion.
 *
 * A cancelled run is still finalized here. cancelRun flips the status straight
 * away so the dashboard reflects the click, but domains already in flight keep
 * running to their next checkpoint and bump counters after that write — so the
 * flush at cancel time is provisional. This is the pass that reconciles it.
 */
export async function finalizeRunIfDone(runId: string): Promise<boolean> {
  const run = await getRun(runId);
  if (!run) return false;
  if (run.status !== "scraping" && run.status !== "discovering" && run.status !== "cancelled") {
    return false;
  }
  if (!(await isRunFinished(runId))) return false;

  const merged = await dedupeRunLeads(runId);
  if (merged > 0) await logEvent(runId, "dedupe", `merged ${merged} duplicate lead(s)`);

  await flushCounters(runId);
  await setRunStatus(runId, (await isCancelled(runId)) ? "cancelled" : "completed");
  await clearCounters(runId);
  await logEvent(runId, "run", "run finished");
  return true;
}
