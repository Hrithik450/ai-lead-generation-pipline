import { closeDb, getRun, listDomains, listEvents } from "@lead/core";
import { approveRun, beginRun } from "../pipeline/orchestrator.js";
import { closeRedis } from "../queue/counters.js";
import { closeQueue } from "../queue/queue.js";

/**
 * Check the orchestrator: query → plan → approval gate → discovery → enqueue.
 *
 *   npm run check:run -w @lead/worker -- "AI startups in Germany with 20-100 employees"
 *   npm run check:run -w @lead/worker -- --approve "..."
 *
 * Without --approve this stops at the gate, which is what a real run does while
 * waiting for a human. That path costs exactly one cheap LLM call and no search
 * credits, so it is the one to use when checking planner changes.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const approve = args.includes("--approve");
  const query = args.filter((a) => !a.startsWith("--")).join(" ");

  if (!query) {
    console.error('usage: npm run check:run -w @lead/worker -- [--approve] "<query>"');
    process.exit(1);
  }

  const { run, plan, error } = await beginRun(query);
  console.log(`run ${run.id}\n`);

  if (error || !plan) {
    console.error(`planning failed: ${error}`);
    await shutdown();
    process.exit(1);
  }

  console.log(`interpretation  ${plan.interpretation}`);
  console.log(`target domains  ${plan.target_domains}`);
  console.log(`requirements    ${JSON.stringify(plan.requirements, null, 2).replace(/\n/g, "\n                ")}`);
  console.log(`\nsearch queries (${plan.search_queries.length}):`);
  for (const q of plan.search_queries) console.log(`  - ${q}`);
  console.log(`\nnotes           ${plan.notes}`);

  const gated = await getRun(run.id);
  console.log(`\nstatus          ${gated?.status}`);

  if (!approve) {
    console.log("\nstopped at the approval gate. re-run with --approve to spend search credits.");
    await shutdown();
    process.exit(0);
  }

  console.log("\napproving...");
  const result = await approveRun(run.id);
  if (result.error) {
    console.error(`approval failed: ${result.error}`);
  } else {
    console.log(`discovered ${result.discovered} domains, enqueued ${result.enqueued}`);
    for (const d of await listDomains(run.id)) {
      console.log(`  ${d.domain} ← ${d.seed_url} (${d.source})`);
    }
  }

  console.log("\nevents:");
  for (const e of (await listEvents(run.id)).reverse()) {
    console.log(`  [${e.level}] ${e.stage}: ${e.message}`);
  }

  await shutdown();
  process.exit(result.error ? 1 : 0);
}

async function shutdown(): Promise<void> {
  await closeQueue();
  await closeRedis();
  await closeDb();
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
