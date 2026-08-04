import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { config } from "../config.js";

/**
 * One long-lived Chromium; N contexts checked out per job.
 *
 * Browser-per-job costs ~150MB and ~700ms each. Contexts are ~5MB and instant,
 * and give the same cookie/storage isolation. Contexts recycle after RECYCLE_AFTER
 * uses because renderer memory creeps under sustained navigation.
 */

const RECYCLE_AFTER = 25;

const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font", "stylesheet"]);

const BLOCKED_URL_PATTERNS = [
  /google-analytics\.com|googletagmanager\.com|doubleclick\.net|facebook\.net/i,
  /hotjar\.com|mixpanel\.com|segment\.(io|com)|amplitude\.com|fullstory\.com/i,
  /intercom\.io|drift\.com|hubspot\.com\/.*\/analytics|clarity\.ms/i,
  /\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp4|webm|mp3)(\?|$)/i,
];

interface PooledContext {
  context: BrowserContext;
  uses: number;
}

class BrowserPool {
  private browser: Browser | null = null;
  private idle: PooledContext[] = [];
  private waiters: ((c: PooledContext) => void)[] = [];
  private created = 0;
  private closing = false;

  async start(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({
      args: [
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--blink-settings=imagesEnabled=false",
      ],
    });
  }

  private async newContext(): Promise<PooledContext> {
    if (!this.browser) await this.start();
    const context = await this.browser!.newContext({
      userAgent: config.userAgent,
      viewport: { width: 1366, height: 900 },
      locale: "en-US",
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      serviceWorkers: "block",
    });
    context.setDefaultTimeout(config.browserTimeoutMs);
    context.setDefaultNavigationTimeout(config.browserTimeoutMs);

    await context.route("**/*", (route) => {
      // A throw inside a route handler leaves page.goto() hanging until timeout,
      // which is the main source of orphaned pages. Never let this reject.
      try {
        const req = route.request();
        if (BLOCKED_RESOURCE_TYPES.has(req.resourceType())) return void route.abort();
        const url = req.url();
        if (BLOCKED_URL_PATTERNS.some((p) => p.test(url))) return void route.abort();
        return void route.continue();
      } catch {
        return void route.continue().catch(() => {});
      }
    });

    this.created += 1;
    return { context, uses: 0 };
  }

  private async acquire(): Promise<PooledContext> {
    const existing = this.idle.pop();
    if (existing) return existing;
    if (this.created < config.browserPoolSize) return this.newContext();
    return new Promise<PooledContext>((resolve) => this.waiters.push(resolve));
  }

  private async release(pooled: PooledContext): Promise<void> {
    pooled.uses += 1;
    if (this.closing) {
      await pooled.context.close().catch(() => {});
      return;
    }
    if (pooled.uses >= RECYCLE_AFTER) {
      await pooled.context.close().catch(() => {});
      this.created -= 1;
      const waiter = this.waiters.shift();
      if (waiter) {
        this.newContext().then(waiter).catch(() => {});
      }
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) waiter(pooled);
    else this.idle.push(pooled);
  }

  /** Runs `fn` with a fresh page. The page is always closed, including on timeout. */
  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const pooled = await this.acquire();
    let page: Page | null = null;
    try {
      page = await pooled.context.newPage();
      return await fn(page);
    } finally {
      if (page) await page.close({ runBeforeUnload: false }).catch(() => {});
      await this.release(pooled);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const pooled of this.idle.splice(0)) {
      await pooled.context.close().catch(() => {});
    }
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.created = 0;
  }

  get stats() {
    return { created: this.created, idle: this.idle.length, waiting: this.waiters.length };
  }
}

export const browserPool = new BrowserPool();
