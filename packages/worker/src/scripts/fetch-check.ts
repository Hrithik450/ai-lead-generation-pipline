/**
 * Standalone fetcher smoke test — no database, no queue.
 *   npx tsx src/scripts/fetch-check.ts https://example.com https://another.com
 */
import { browserPool } from "../fetch/browser-pool.js";
import { fetchPage, tier1Guard } from "../fetch/tiered-fetcher.js";

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error("usage: tsx src/scripts/fetch-check.ts <url> [url...]");
  process.exit(1);
}

for (const url of urls) {
  const started = Date.now();
  try {
    const r = await fetchPage(url);
    console.log(
      [
        `${r.outcome.padEnd(18)} tier=${r.tier}`,
        `status=${r.statusCode ?? "-"}`,
        `text=${r.text?.length ?? 0}`,
        `${Date.now() - started}ms`,
        r.finalUrl,
      ].join("  "),
    );
    if (r.escalationReason) console.log(`   why: ${r.escalationReason}`);
    if (r.error) console.log(`   err: ${r.error}`);
    if (r.signals) {
      console.log(
        `   signals: script=${(r.signals.scriptByteRatio * 100) | 0}% spa=${r.signals.emptyRootMount} consent=${r.signals.consentWall} challenge=${r.signals.challenge.isChallenge}`,
      );
    }
  } catch (err) {
    console.log(`THREW  ${url}  ${(err as Error).message}`);
  }
}

console.log(`\ntier-1 ratio in window: ${(tier1Guard.ratio * 100).toFixed(1)}%`);
await browserPool.close();
