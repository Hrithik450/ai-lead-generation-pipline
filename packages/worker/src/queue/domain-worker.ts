import { Worker, type Job } from "bullmq";
import { insertPage, logEvent, setDomainStatus, upsertLead } from "@lead/core";
import { config } from "../config.js";
import { processDomain } from "../pipeline/domain.js";
import { finalizeRunIfDone, flushCounters } from "../pipeline/run.js";
import { scoreLead } from "../pipeline/score.js";
import { validateLead } from "../pipeline/validate.js";
import { bumpCounters, isCancelled, redis } from "./counters.js";
import { DOMAIN_QUEUE, type DomainJobData, type DomainJobResult } from "./queue.js";

/**
 * The domain worker.
 *
 * Timing is the delicate part. A domain job fetches up to MAX_PAGES_PER_DOMAIN
 * pages, each with its own politeness delay, tier escalation and possible browser
 * launch, then makes one LLM call — so worst case is minutes, not seconds. Two
 * settings follow from that and both are load-bearing:
 *
 *   lockDuration must exceed the worst-case time between heartbeats, or BullMQ
 *   considers the job stalled while it is in fact working.
 *
 *   maxStalledCount defaults to 1, and a stalled job goes straight to failed
 *   rather than being retried. Without a generous lock, domains vanish from a run
 *   with no error anyone can see.
 */

/** Longer than any single page fetch (browser timeout + politeness + slack). */
const LOCK_DURATION_MS = 120_000;

export function startDomainWorker(): Worker<DomainJobData, DomainJobResult> {
  const worker = new Worker<DomainJobData, DomainJobResult>(DOMAIN_QUEUE, runDomainJob, {
    connection: redis(),
    concurrency: config.workerConcurrency,
    lockDuration: LOCK_DURATION_MS,
  });

  // A job that throws its way out of every attempt never reaches the terminal
  // status write at the end of runDomainJob, so its domain would sit at
  // "fetching" forever and the run would never finalize. BullMQ reports the
  // exhausted job here, and this is the only place left to close the row out.
  worker.on("failed", (job, err) => {
    const domain = job?.data.domain ?? "unknown";
    console.error(`[worker] ${domain} failed: ${err.message}`);
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    void closeOutFailedJob(job, err);
  });

  return worker;
}

async function closeOutFailedJob(
  job: Job<DomainJobData, DomainJobResult>,
  err: Error,
): Promise<void> {
  const { runId, domainId, domain } = job.data;
  try {
    await setDomainStatus(domainId, "failed", { outcome: "unreachable", note: err.message });
    await bumpCounters(runId, { domains_done: 1, domains_failed: 1 });
    await logEvent(runId, "scrape", `${domain}: ${err.message}`, { level: "error" });
    await settleRun(runId);
  } catch (settleErr) {
    console.error(
      `[worker] could not close out ${domain}: ${settleErr instanceof Error ? settleErr.message : String(settleErr)}`,
    );
  }
}

/**
 * Finalize the run if this was its last domain.
 *
 * Every worker calls this after every domain, and only the one that observes the
 * last terminal domain does anything — `finalizeRunIfDone` re-reads the domains
 * table and no-ops otherwise, so concurrent callers converge on one completion
 * rather than racing. Doing it here rather than on a timer is what makes a run
 * finish the moment its work does.
 *
 * Failing to finalize must not fail the job. The domain's own result is already
 * committed, and the periodic flush plus the next domain's call both get another
 * chance at it.
 */
async function settleRun(runId: string): Promise<void> {
  try {
    await flushCounters(runId);
    await finalizeRunIfDone(runId);
  } catch (err) {
    console.warn(
      `[worker] finalize check failed for run ${runId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function runDomainJob(job: Job<DomainJobData, DomainJobResult>): Promise<DomainJobResult> {
  const { runId, domainId, domain, seedUrl, requirements } = job.data;

  if (await isCancelled(runId)) {
    await setDomainStatus(domainId, "skipped", { note: "run cancelled" });
    await settleRun(runId);
    return { domainId };
  }

  await setDomainStatus(domainId, "fetching");

  const result = await processDomain({
    domain,
    seedUrl,
    requirements,
    // Checked between pages. Two jobs of work: stop a cancelled run promptly, and
    // renew the lock so a slow-but-healthy domain is never declared stalled.
    isCancelled: async () => {
      await heartbeat(job);
      return isCancelled(runId);
    },
  });

  for (const page of result.pages) {
    await insertPage({
      domain_id: domainId,
      url: page.url,
      final_url: page.finalUrl,
      kind: page.kind,
      tier: page.tier,
      status_code: page.statusCode,
      content_hash: page.contentHash,
      text_length: null,
      blocked: page.tier === 2 || page.error !== null,
      error: page.error,
    });
  }

  const lead = result.lead;
  if (lead) {
    // Validate then score per domain. Dedupe is deliberately not here: it compares
    // leads against each other and cannot be done from inside a job that only sees
    // one domain. It runs as a run-level sweep at finalize.
    const validated = validateLead(lead, domain);
    const scored = scoreLead(validated, requirements);
    if (validated.issues.length > 0) {
      await logEvent(runId, "validate", `${domain}: dropped ${validated.issues.length} unusable value(s)`, {
        level: "warn",
        data: { issues: validated.issues },
      });
    }
    await upsertLead({
      run_id: runId,
      domain_id: domainId,
      domain,
      company_name: scored.companyName,
      website: seedUrl,
      description: scored.description,
      industry: scored.industry,
      country: scored.country,
      city: scored.city,
      address: scored.address,
      employee_count: scored.employeeCount,
      employee_range: scored.employeeRange,
      founded_year: scored.foundedYear,
      funding_stage: scored.fundingStage,
      funding_amount: scored.fundingAmount,
      funding_year: scored.fundingYear,
      emails: scored.emails,
      phones: scored.phones,
      socials: scored.socials,
      people: scored.people,
      technologies: scored.technologies,
      contact_form_url: scored.contactFormUrl,
      provenance: scored.provenance,
      score: scored.score,
      score_breakdown: scored.scoreBreakdown,
      match_reason: scored.matchReason,
    });
  }

  // A domain that stopped at a checkpoint reached no verdict, so it is neither
  // done nor failed. Marking it skipped keeps it terminal — which is what lets a
  // cancelled run finalize instead of sitting at "fetching" forever — without
  // polluting the failure rate with domains nobody actually tried to scrape.
  if (result.cancelled) {
    await setDomainStatus(domainId, "skipped", {
      note: "run cancelled",
      pages: result.pages.length,
      max_tier: result.maxTier,
    });
    await bumpCounters(runId, {
      pages_fetched: result.pages.length,
      tier1_pages: result.pages.filter((p) => p.tier === 1).length,
      tier2_pages: result.pages.filter((p) => p.tier === 2).length,
    });
    await settleRun(runId);
    return { domainId };
  }

  const failed = result.outcome === "unreachable" || result.outcome === "blocked";
  await setDomainStatus(domainId, failed ? "failed" : "done", {
    outcome: result.outcome,
    note: result.note ?? undefined,
    pages: result.pages.length,
    max_tier: result.maxTier,
  });

  await bumpCounters(runId, {
    domains_done: 1,
    domains_failed: failed ? 1 : 0,
    pages_fetched: result.pages.length,
    tier1_pages: result.pages.filter((p) => p.tier === 1).length,
    tier2_pages: result.pages.filter((p) => p.tier === 2).length,
    llm_input_tokens: result.usage.input,
    llm_output_tokens: result.usage.output,
    llm_cached_tokens: result.usage.cacheRead,
  });

  await settleRun(runId);

  return { domainId };
}

/**
 * Renew the lock between pages.
 *
 * A failure here is worth a line in the log but must not abort the domain: the
 * usual cause is that the job was already declared stalled, and throwing would
 * discard pages we successfully fetched. Swallowing it silently would hide a
 * systematic lock problem, so it is logged rather than ignored.
 */
async function heartbeat(job: Job<DomainJobData, DomainJobResult>): Promise<void> {
  if (!job.token) return;
  try {
    await job.extendLock(job.token, LOCK_DURATION_MS);
  } catch (err) {
    console.warn(
      `[worker] ${job.data.domain} lock renewal failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
