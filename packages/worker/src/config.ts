function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

function oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  const hit = allowed.find((a) => a === raw);
  if (!hit) {
    throw new Error(`${name} must be one of ${allowed.join(", ")} — got "${raw}"`);
  }
  return hit;
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://lead:lead@localhost:5432/lead",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  storageDir: process.env.STORAGE_DIR ?? "./storage",

  /** Which LLM vendor to use. Swapping this is the only change a provider switch needs. */
  llmProvider: oneOf("LLM_PROVIDER", ["google", "openai", "anthropic"] as const, "google"),
  /** Per-domain extraction model. Empty means the provider's cheapest tier. */
  extractModel: process.env.EXTRACT_MODEL ?? "",
  /** Query-planning model. Empty means the provider's cheapest tier. */
  planModel: process.env.PLAN_MODEL ?? "",

  googleApiKey: process.env.GOOGLE_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",

  tavilyApiKey: process.env.TAVILY_API_KEY ?? "",
  exaApiKey: process.env.EXA_API_KEY ?? "",
  hunterApiKey: process.env.HUNTER_API_KEY ?? "",
  scrapingbeeApiKey: process.env.SCRAPINGBEE_API_KEY ?? "",
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY ?? "",

  workerConcurrency: num("WORKER_CONCURRENCY", 4),
  browserPoolSize: num("BROWSER_POOL_SIZE", 4),
  maxPagesPerDomain: num("MAX_PAGES_PER_DOMAIN", 6),

  /** Control API port. Compose-internal only — the endpoint has no auth. */
  controlPort: num("CONTROL_PORT", 4000),

  /** Halt the run if tier-1 escalations exceed this share of pages in a 5-minute window. */
  tier1AlarmRatio: num("GLOBAL_TIER1_ALARM_RATIO", 0.25),

  /** GDPR: named-person emails are personal data. Off by default; role addresses only. */
  allowPersonalEmails: bool("ALLOW_PERSONAL_EMAILS", false),

  userAgent:
    process.env.USER_AGENT ??
    "LeadBot/0.1 (+https://example.com/bot; respects robots.txt)",

  requestTimeoutMs: num("REQUEST_TIMEOUT_MS", 20_000),
  browserTimeoutMs: num("BROWSER_TIMEOUT_MS", 30_000),
  maxBodyBytes: num("MAX_BODY_BYTES", 5 * 1024 * 1024),

  /** Minimum delay between requests to the same registrable domain. */
  perHostDelayMs: num("PER_HOST_DELAY_MS", 1_500),
} as const;

export type Config = typeof config;
