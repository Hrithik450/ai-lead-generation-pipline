import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "../src/providers/search.js";

const providerMocks = vi.hoisted(() => ({ searchProviders: vi.fn() }));

vi.mock("../src/providers/search.js", () => ({
  searchProviders: providerMocks.searchProviders,
  searchAvailable: () => providerMocks.searchProviders().length > 0,
}));

const { discoverDomains } = await import("../src/pipeline/discover.js");

/** A provider that returns fixed hits, ignoring the query. */
function stub(name: string, urls: string[]) {
  return {
    name,
    search: vi.fn(
      async (): Promise<SearchHit[]> =>
        urls.map((url) => ({ url, title: "t", snippet: "s", provider: name })),
    ),
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("domain discovery", () => {
  it("returns nothing when no provider is configured", async () => {
    providerMocks.searchProviders.mockReturnValue([]);
    const r = await discoverDomains({ queries: ["ai startups"], targetDomains: 10 });
    expect(r.domains).toEqual([]);
    expect(r.queriesRun).toBe(0);
  });

  // One company surfaces as a homepage, a blog post, and a press release across
  // several queries. Enqueuing each would scrape it three times and bill three
  // LLM calls for one lead.
  it("collapses many urls of one company to a single domain", async () => {
    providerMocks.searchProviders.mockReturnValue([
      stub("tavily", [
        "https://acme.de/blog/post-1",
        "https://acme.de/",
        "https://www.acme.de/about",
      ]),
    ]);
    const r = await discoverDomains({ queries: ["q1"], targetDomains: 10 });
    expect(r.domains).toHaveLength(1);
    expect(r.domains[0]?.domain).toBe("acme.de");
    expect(r.domains[0]?.hits).toBe(3);
  });

  // A blog post outranks a homepage for a specific query, but the homepage is
  // where a company describes itself and is the better place to start a crawl.
  it("seeds the crawl at the shallowest url seen", async () => {
    providerMocks.searchProviders.mockReturnValue([
      stub("tavily", ["https://acme.de/blog/2026/why-we-raised", "https://acme.de/"]),
    ]);
    const r = await discoverDomains({ queries: ["q1"], targetDomains: 10 });
    expect(r.domains[0]?.seedUrl).toBe("https://acme.de/");
  });

  it("drops hosts that cannot yield a company lead", async () => {
    providerMocks.searchProviders.mockReturnValue([
      stub("tavily", [
        "https://www.linkedin.com/company/acme",
        "https://acme.wixsite.com/home",
        "https://acme.de/",
      ]),
    ]);
    const r = await discoverDomains({ queries: ["q1"], targetDomains: 10 });
    expect(r.domains.map((d) => d.domain)).toEqual(["acme.de"]);
  });

  it("merges the same domain across providers and counts both hits", async () => {
    providerMocks.searchProviders.mockReturnValue([
      stub("tavily", ["https://acme.de/"]),
      stub("exa", ["https://acme.de/about"]),
    ]);
    const r = await discoverDomains({ queries: ["q1"], targetDomains: 10 });
    expect(r.domains).toHaveLength(1);
    expect(r.domains[0]?.hits).toBe(2);
    expect(r.domains[0]?.source).toBe("tavily");
  });

  // Discovery is the one stage with no local fallback, so one provider going
  // down must not take the run with it.
  it("keeps the surviving provider's results when the other errors", async () => {
    const broken = {
      name: "exa",
      search: vi.fn(async (): Promise<SearchHit[]> => {
        throw new Error("exa 429: rate limited");
      }),
    };
    providerMocks.searchProviders.mockReturnValue([stub("tavily", ["https://acme.de/"]), broken]);

    const r = await discoverDomains({ queries: ["q1"], targetDomains: 10 });
    expect(r.domains.map((d) => d.domain)).toEqual(["acme.de"]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.provider).toBe("exa");
  });

  it("ranks domains corroborated by more queries first", async () => {
    providerMocks.searchProviders.mockReturnValue([
      stub("tavily", ["https://one-hit.de/", "https://popular.de/"]),
    ]);
    const r = await discoverDomains({ queries: ["q1", "q2"], targetDomains: 1 });
    // Both were seen twice here, so the tie-break is alphabetical and stable.
    expect(r.domains).toHaveLength(1);
    expect(r.domains[0]?.domain).toBe("one-hit.de");
  });

  // Every query issued is a paid credit, so the target is a spend ceiling.
  it("stops issuing searches once the target is met", async () => {
    const provider = stub("tavily", ["https://a.de/", "https://b.de/", "https://c.de/"]);
    providerMocks.searchProviders.mockReturnValue([provider]);

    const r = await discoverDomains({ queries: ["q1", "q2", "q3", "q4"], targetDomains: 3 });
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(r.queriesRun).toBe(1);
    expect(r.domains).toHaveLength(3);
  });

  it("never returns more domains than the plan approved", async () => {
    providerMocks.searchProviders.mockReturnValue([
      stub("tavily", ["https://a.de/", "https://b.de/", "https://c.de/", "https://d.de/"]),
    ]);
    const r = await discoverDomains({ queries: ["q1"], targetDomains: 2 });
    expect(r.domains).toHaveLength(2);
  });
});
