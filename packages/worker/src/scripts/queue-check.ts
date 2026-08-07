import { RequirementsSchema, createRun, listDomains, listLeads, getRun } from "@lead/core";
import { startRun, finalizeRunIfDone, cancelRun } from "../pipeline/run.js";
import { startDomainWorker } from "../queue/domain-worker.js";
import { readCounters, closeRedis } from "../queue/counters.js";
import { closeQueue } from "../queue/queue.js";
import { browserPool } from "../fetch/browser-pool.js";
import { closeDb } from "@lead/core";

/**
 * End-to-end check of the queue path: enqueue → worker → counters → finalize.
 *
 *   npm run check:queue -w @lead/worker -- https://a.com https://b.com
 *   npm run check:queue -w @lead/worker -- --cancel https://a.com https://b.com
 *
 * With --cancel the run is cancelled shortly after enqueue, which is the only way
 * to see that in-flight jobs stop at a checkpoint and queued ones are dropped.
 */

const REQUIREMENTS = RequirementsSchema.parse({
  industry: "AI startups",
  countries: ["Germany"],
  cities: [],
  employee_min: 20,
  employee_max: 100,
  founded_after: null,
  funding_required: true,
  funding_since_year: 2024,
  keywords: ["machine learning", "artificial intelligence"],
  exclusions: ["consultancy", "staffing agency"],
});

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cancelMode = args.includes("--cancel");
  const urls = args.filter((a) => !a.startsWith("--"));
  if (urls.length === 0) {
    console.error("usage: npm run check:queue -w @lead/worker -- [--cancel] <url> [url ...]");
    process.exit(1);
  }

  const run = await createRun("queue check");
  console.log(`run ${run.id}${cancelMode ? " (cancel mode)" : ""}\n`);

  const worker = startDomainWorker();

  const total = await startRun({
    runId: run.id,
    requirements: REQUIREMENTS,
    domains: urls.map((u) => ({
      domain: new URL(u).hostname.replace(/^www\./, ""),
      seedUrl: u,
      source: "manual",
    })),
  });
  console.log(`enqueued ${total} domains`);

  if (cancelMode) {
    await new Promise((r) => setTimeout(r, 3_000));
    const { drained } = await cancelRun(run.id);
    console.log(`cancelled, ${drained} queued domains dropped`);
  }

  // Poll rather than listen: finalize is idempotent, and this mirrors how the
  // orchestrator will sweep runs it did not itself enqueue. A cancelled run is
  // polled to completion too — cancelRun flips the status immediately, but
  // in-flight domains keep going to their checkpoint, and this is what waits for
  // them and reconciles the counters.
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    if (await finalizeRunIfDone(run.id)) break;
    await new Promise((r) => setTimeout(r, 2_000));
  }

  const finalRun = await getRun(run.id);
  const domains = await listDomains(run.id);
  const leads = await listLeads(run.id);
  const counters = await readCounters(run.id);

  console.log(`\nstatus     ${finalRun?.status}`);
  console.log(`domains    ${domains.length} total`);
  for (const d of domains) {
    console.log(`  ${d.domain} → ${d.status}${d.outcome ? ` (${d.outcome})` : ""} pages=${d.pages} tier=${d.max_tier}`);
  }
  console.log(`leads      ${leads.length}`);
  for (const l of leads) {
    console.log(`  ${l.company_name ?? l.domain} — ${l.emails.join(", ") || "no email"}`);
  }
  console.log(`redis      ${JSON.stringify(counters)}`);
  console.log(
    `postgres   done=${finalRun?.domains_done} failed=${finalRun?.domains_failed} pages=${finalRun?.pages_fetched} in=${finalRun?.llm_input_tokens} out=${finalRun?.llm_output_tokens}`,
  );

  await worker.close();
  await browserPool.close();
  await closeQueue();
  await closeRedis();
  await closeDb();
  process.exit(0);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
