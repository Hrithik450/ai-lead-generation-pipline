import {
  createRun,
  getRun,
  logEvent,
  setDomainsTotal,
  setRunPlan,
  setRunStatus,
  type Plan,
  type RunRow,
} from "@lead/core";
import { searchAvailable } from "../providers/search.js";
import { discoverDomains } from "./discover.js";
import { planRun } from "./plan.js";
import { startRun } from "./run.js";

/**
 * Run orchestration: query → plan → approval → discovery → scrape.
 *
 * Split into two calls rather than one, because the human approval gate sits
 * between them. `beginRun` spends one cheap LLM call and stops; `approveRun`
 * is what starts spending real money on search credits and scraping. A single
 * function would have to either block on input or bypass the gate.
 *
 * The plan's own `target_domains` is honoured rather than overridden. It was set
 * by a model that read the query and is the number the user approved — silently
 * scraping more is spending money they did not agree to.
 */

export interface BeginRunResult {
  run: RunRow;
  plan: Plan | null;
  error: string | null;
}

/**
 * Plan a run and stop at the approval gate.
 *
 * The run row is created before planning so a failed plan is still inspectable
 * rather than vanishing — a run that failed to plan is a thing the user needs to
 * see, not an error that scrolls past in a log.
 */
export async function beginRun(query: string): Promise<BeginRunResult> {
  const run = await createRun(query);
  await logEvent(run.id, "plan", `planning: ${query}`);

  const result = await planRun(query, new Date().getUTCFullYear());

  if (result.outcome !== "ok" || !result.plan) {
    const error = result.error ?? "planner returned no plan";
    await setRunStatus(run.id, "failed", error);
    await logEvent(run.id, "plan", `planning failed: ${error}`, { level: "error" });
    return { run, plan: null, error };
  }

  await setRunPlan(run.id, result.plan);
  await logEvent(
    run.id,
    "plan",
    `plan ready: ${result.plan.search_queries.length} queries, target ${result.plan.target_domains} domains`,
    { data: { interpretation: result.plan.interpretation, notes: result.plan.notes } },
  );

  return { run: (await getRun(run.id)) ?? run, plan: result.plan, error: null };
}

export interface ApproveRunResult {
  discovered: number;
  enqueued: number;
  error: string | null;
}

/**
 * Approve a planned run: discover domains, then enqueue them for scraping.
 *
 * Guarded on `awaiting_approval` so a double click, a retried request, or two
 * operators approving at once cannot enqueue the same run's domains twice. The
 * status flip to `discovering` happens before any search call, so the second
 * caller finds the gate already closed.
 */
export async function approveRun(runId: string): Promise<ApproveRunResult> {
  const run = await getRun(runId);
  if (!run) return { discovered: 0, enqueued: 0, error: "run not found" };
  if (run.status !== "awaiting_approval") {
    return { discovered: 0, enqueued: 0, error: `run is ${run.status}, not awaiting approval` };
  }
  if (!run.plan || !run.requirements) {
    return { discovered: 0, enqueued: 0, error: "run has no approved plan" };
  }
  if (!searchAvailable()) {
    const error = "no search provider configured — set TAVILY_API_KEY or EXA_API_KEY";
    await setRunStatus(runId, "failed", error);
    await logEvent(runId, "discover", error, { level: "error" });
    return { discovered: 0, enqueued: 0, error };
  }

  await setRunStatus(runId, "discovering");
  await logEvent(runId, "discover", `approved; running ${run.plan.search_queries.length} queries`);

  const discovery = await discoverDomains({
    queries: run.plan.search_queries,
    targetDomains: run.plan.target_domains,
    onProgress: (message) => logEvent(runId, "discover", message),
  });

  for (const err of discovery.errors) {
    await logEvent(runId, "discover", `${err.provider} failed on "${err.query}": ${err.message}`, {
      level: "warn",
    });
  }

  await logEvent(
    runId,
    "discover",
    `${discovery.domains.length} domains from ${discovery.hitsSeen} hits across ${discovery.queriesRun} queries`,
  );

  if (discovery.domains.length === 0) {
    // Every provider failing and every provider returning nothing are different
    // problems, and the person reading this needs to know which one happened.
    const error =
      discovery.errors.length > 0
        ? "discovery found no domains; every search provider errored"
        : "discovery found no domains for this plan's queries";
    await setDomainsTotal(runId, 0);
    await setRunStatus(runId, "failed", error);
    await logEvent(runId, "discover", error, { level: "error" });
    return { discovered: 0, enqueued: 0, error };
  }

  const enqueued = await startRun({
    runId,
    requirements: run.requirements,
    domains: discovery.domains.map((d) => ({
      domain: d.domain,
      seedUrl: d.seedUrl,
      source: d.source,
    })),
  });

  return { discovered: discovery.domains.length, enqueued, error: null };
}
