import { closeDb, listLeads, listShippableLeads } from "@lead/core";
import { dedupeRunLeads } from "../pipeline/run.js";

/**
 * Exercise the dedupe sweep against an existing run, without re-scraping.
 *
 *   npm run check:dedupe -w @lead/worker -- <run-id>
 *
 * Dedupe only triggers when a run holds two leads for the same company, which a
 * real run produces rarely and never on demand. This runs the sweep over a run
 * that already exists so the merge path can be verified without spending a single
 * LLM call to manufacture the duplicate.
 */
async function main(): Promise<void> {
  const runId = process.argv[2];
  if (!runId) {
    console.error("usage: npm run check:dedupe -w @lead/worker -- <run-id>");
    process.exit(1);
  }

  console.log(`merged ${await dedupeRunLeads(runId)} lead(s)\n`);

  console.log("all leads:");
  for (const l of await listLeads(runId)) {
    const merged = l.merged_into ? "absorbed" : "survivor";
    const absorbed = l.merged_domains.length > 0 ? ` ← ${l.merged_domains.join(", ")}` : "";
    console.log(`  ${l.domain} score=${l.score} ${merged}${absorbed}`);
    console.log(`    phones=${JSON.stringify(l.phones)} funding=${l.funding_stage ?? "-"}`);
  }

  console.log("\nshippable:");
  for (const l of await listShippableLeads(runId)) {
    console.log(`  ${l.domain} score=${l.score}`);
  }

  await closeDb();
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
