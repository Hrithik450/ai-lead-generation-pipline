import { closeDb } from "@lead/core";
import { startControlApi } from "./api/control.js";
import { browserPool } from "./fetch/browser-pool.js";
import { closeRedis } from "./queue/counters.js";
import { startDomainWorker } from "./queue/domain-worker.js";
import { closeQueue } from "./queue/queue.js";

/**
 * Worker entrypoint.
 *
 * Shutdown order is not arbitrary: stop accepting work, let in-flight domain jobs
 * finish their current page, then tear down the browser. Closing Chromium first
 * would fail every job still mid-fetch. docker-compose sets stop_grace_period to
 * 60s so this can actually complete — the 10s default kills a run mid-crawl.
 */

async function main(): Promise<void> {
  const worker = startDomainWorker();
  const api = startControlApi();
  console.log("[worker] listening for domain jobs");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] ${signal} received, finishing in-flight jobs`);

    // The API closes first: it only starts work, so refusing new runs while the
    // queue drains is exactly right.
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await worker.close();
    await browserPool.close();
    await closeQueue();
    await closeRedis();
    await closeDb();

    console.log("[worker] shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
