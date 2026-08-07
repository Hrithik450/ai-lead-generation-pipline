import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, RunRow } from "@lead/core";

/**
 * Orchestrator tests, with the database, planner, search, and queue all stubbed.
 *
 * What is being checked is the approval gate, not the pieces it coordinates: a
 * planned run must not spend search credits until a human approves, must not
 * spend twice if approved twice, and must leave a readable failure behind when
 * it cannot proceed. Those are exactly the properties that are expensive to get
 * wrong and impossible to observe from a passing live run.
 */

const db = vi.hoisted(() => ({
  createRun: vi.fn(),
  getRun: vi.fn(),
  logEvent: vi.fn(async () => undefined),
  setDomainsTotal: vi.fn(async () => undefined),
  setRunPlan: vi.fn(async () => undefined),
  setRunStatus: vi.fn(async () => undefined),
}));
const mocks = vi.hoisted(() => ({
  planRun: vi.fn(),
  discoverDomains: vi.fn(),
  searchAvailable: vi.fn(() => true),
  startRun: vi.fn(async () => 0),
}));

vi.mock("@lead/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lead/core")>()),
  ...db,
}));
vi.mock("../src/pipeline/plan.js", () => ({ planRun: mocks.planRun }));
vi.mock("../src/pipeline/discover.js", () => ({ discoverDomains: mocks.discoverDomains }));
vi.mock("../src/providers/search.js", () => ({ searchAvailable: mocks.searchAvailable }));
vi.mock("../src/pipeline/run.js", () => ({ startRun: mocks.startRun }));

const { approveRun, beginRun } = await import("../src/pipeline/orchestrator.js");

const PLAN: Plan = {
  interpretation: "AI companies in Germany",
  requirements: {
    industry: "artificial intelligence",
    countries: ["Germany"],
    cities: [],
    employee_min: 20,
    employee_max: 100,
    funding_since_year: 2024,
    keywords: ["machine learning"],
    exclusions: ["agency"],
  },
  search_queries: ["ai startups germany", "ki startups deutschland"],
  target_domains: 40,
  notes: "headcount is rarely published",
};

function run(over: Partial<RunRow> = {}): RunRow {
  return {
    id: "run-1",
    query: "AI companies in Germany",
    status: "awaiting_approval",
    plan: PLAN,
    requirements: PLAN.requirements,
    error: null,
    domains_total: 0,
    domains_done: 0,
    domains_failed: 0,
    pages_fetched: 0,
    tier1_pages: 0,
    tier2_pages: 0,
    llm_input_tokens: 0,
    llm_output_tokens: 0,
    llm_cached_tokens: 0,
    created_at: "2026-01-01T00:00:00Z",
    approved_at: null,
    finished_at: null,
    ...over,
  };
}

function discovery(over: Partial<Awaited<ReturnType<typeof mocks.discoverDomains>>> = {}) {
  return {
    domains: [{ domain: "acme.de", seedUrl: "https://acme.de/", source: "tavily", hits: 2, title: "", snippet: "" }],
    errors: [],
    queriesRun: 1,
    hitsSeen: 5,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.createRun.mockResolvedValue(run({ status: "planning" }));
  db.getRun.mockResolvedValue(run());
  mocks.searchAvailable.mockReturnValue(true);
  mocks.planRun.mockResolvedValue({ outcome: "ok", plan: PLAN, usage: {}, error: null });
  mocks.discoverDomains.mockResolvedValue(discovery());
  mocks.startRun.mockResolvedValue(1);
});

describe("beginRun", () => {
  it("stops at the gate without discovering or scraping", async () => {
    const result = await beginRun("AI companies in Germany");
    expect(result.plan).toEqual(PLAN);
    expect(result.error).toBeNull();
    expect(mocks.discoverDomains).not.toHaveBeenCalled();
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  // A run that failed to plan is something the user needs to see and retry from,
  // not an error that scrolls past in a log.
  it("keeps a failed plan inspectable as a failed run", async () => {
    mocks.planRun.mockResolvedValue({
      outcome: "error",
      plan: null,
      usage: {},
      error: "gemini 429: quota exceeded",
    });

    const result = await beginRun("AI companies in Germany");
    expect(result.plan).toBeNull();
    expect(result.error).toContain("quota exceeded");
    expect(db.createRun).toHaveBeenCalled();
    expect(db.setRunStatus).toHaveBeenCalledWith("run-1", "failed", expect.stringContaining("quota"));
  });

  // The planner can return outcome "ok" with nothing attached; treating that as
  // success would approve a run with no queries to spend on.
  it("fails when the planner returns no plan", async () => {
    mocks.planRun.mockResolvedValue({ outcome: "no_output", plan: null, usage: {}, error: null });
    const result = await beginRun("AI companies in Germany");
    expect(result.error).toBeTruthy();
    expect(db.setRunPlan).not.toHaveBeenCalled();
  });
});

describe("approveRun", () => {
  it("discovers and enqueues once approved", async () => {
    const result = await approveRun("run-1");
    expect(result.error).toBeNull();
    expect(result.discovered).toBe(1);
    expect(result.enqueued).toBe(1);
    expect(mocks.discoverDomains).toHaveBeenCalledWith(
      expect.objectContaining({ queries: PLAN.search_queries, targetDomains: 40 }),
    );
  });

  // A double-click, a retried request, or two operators approving at once must
  // not enqueue the same domains twice — that is the run's whole budget spent
  // a second time.
  it("refuses a run that is no longer awaiting approval", async () => {
    db.getRun.mockResolvedValue(run({ status: "discovering" }));
    const result = await approveRun("run-1");
    expect(result.error).toContain("not awaiting approval");
    expect(mocks.discoverDomains).not.toHaveBeenCalled();
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  // The gate closes before the first search call, so a concurrent second caller
  // finds it shut rather than racing through behind the first.
  it("closes the gate before spending a search credit", async () => {
    const order: string[] = [];
    db.setRunStatus.mockImplementation(async (_id: string, status: string) => {
      order.push(`status:${status}`);
    });
    mocks.discoverDomains.mockImplementation(async () => {
      order.push("discover");
      return discovery();
    });

    await approveRun("run-1");
    expect(order.indexOf("status:discovering")).toBeLessThan(order.indexOf("discover"));
  });

  it("fails fast when no search provider is configured", async () => {
    mocks.searchAvailable.mockReturnValue(false);
    const result = await approveRun("run-1");
    expect(result.error).toContain("TAVILY_API_KEY");
    expect(mocks.discoverDomains).not.toHaveBeenCalled();
    expect(db.setRunStatus).toHaveBeenCalledWith("run-1", "failed", expect.any(String));
  });

  it("rejects an unknown run", async () => {
    db.getRun.mockResolvedValue(undefined);
    const result = await approveRun("missing");
    expect(result.error).toBe("run not found");
  });

  // Every provider being down and every provider returning nothing are different
  // problems with different fixes, and the failure message has to say which.
  it("distinguishes a provider outage from a plan that found nothing", async () => {
    mocks.discoverDomains.mockResolvedValue(
      discovery({ domains: [], errors: [{ provider: "tavily", query: "q", message: "429" }] }),
    );
    expect((await approveRun("run-1")).error).toContain("every search provider errored");

    vi.clearAllMocks();
    db.getRun.mockResolvedValue(run());
    mocks.searchAvailable.mockReturnValue(true);
    mocks.discoverDomains.mockResolvedValue(discovery({ domains: [] }));
    expect((await approveRun("run-1")).error).toContain("no domains for this plan's queries");
  });

  // Zeroing the total matters: a run left at its planned target looks stuck at
  // 0/40 forever rather than finished with nothing.
  it("zeroes the domain total when discovery comes back empty", async () => {
    mocks.discoverDomains.mockResolvedValue(discovery({ domains: [] }));
    await approveRun("run-1");
    expect(db.setDomainsTotal).toHaveBeenCalledWith("run-1", 0);
  });

  // The target is the number the user approved. Scraping past it is spending
  // money they did not agree to.
  it("honours the approved target rather than a default", async () => {
    db.getRun.mockResolvedValue(run({ plan: { ...PLAN, target_domains: 7 } }));
    await approveRun("run-1");
    expect(mocks.discoverDomains).toHaveBeenCalledWith(expect.objectContaining({ targetDomains: 7 }));
  });

  it("surfaces per-provider failures as warnings without failing the run", async () => {
    mocks.discoverDomains.mockResolvedValue(
      discovery({ errors: [{ provider: "exa", query: "q1", message: "429 rate limited" }] }),
    );
    const result = await approveRun("run-1");
    expect(result.error).toBeNull();
    expect(db.logEvent).toHaveBeenCalledWith(
      "run-1",
      "discover",
      expect.stringContaining("exa failed"),
      expect.objectContaining({ level: "warn" }),
    );
  });
});
