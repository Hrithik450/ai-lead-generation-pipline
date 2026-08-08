import type { RunStatus } from "@lead/core";

/**
 * How a run's control API is reached from the dashboard's server actions.
 *
 * Reads go straight to Postgres — a run is a row and an API in front of a SELECT
 * buys nothing. Writes go here, because starting a run needs the planner,
 * approving it needs the search providers, and cancelling needs BullMQ, none of
 * which belong in a Next.js server bundle alongside Playwright.
 */

const CONTROL_URL = process.env.WORKER_CONTROL_URL ?? "http://127.0.0.1:4000";

export interface ControlResult<T> {
  data: T | null;
  error: string | null;
}

async function post<T>(path: string, body?: unknown): Promise<ControlResult<T>> {
  try {
    const res = await fetch(`${CONTROL_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
    });
    const json = (await res.json()) as T & { error?: string };
    // The worker returns 409 for a rejected approval and 422 for a failed plan.
    // Both carry a message the user needs to read, so the body wins over status.
    if (json.error) return { data: null, error: json.error };
    if (!res.ok) return { data: null, error: `worker returned ${res.status}` };
    return { data: json, error: null };
  } catch (err) {
    // The usual cause is the worker not running, which is worth saying plainly
    // rather than surfacing a raw ECONNREFUSED.
    const message = err instanceof Error ? err.message : String(err);
    return {
      data: null,
      error: message.includes("fetch failed")
        ? "cannot reach the worker — is it running?"
        : message,
    };
  }
}

export function createRun(query: string) {
  return post<{ runId: string }>("/runs", { query });
}

export function approveRun(runId: string) {
  return post<{ discovered: number; enqueued: number }>(`/runs/${runId}/approve`);
}

export function cancelRun(runId: string) {
  return post<{ drained: number }>(`/runs/${runId}/cancel`);
}

/** Statuses where the run is doing work and the page should keep refreshing. */
export function isActive(status: RunStatus): boolean {
  return status === "discovering" || status === "scraping" || status === "planning";
}
