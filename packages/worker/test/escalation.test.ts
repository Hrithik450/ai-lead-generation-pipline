import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeSignals, decideEscalation } from "../src/fetch/escalation.js";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

const HTML = { "content-type": "text/html; charset=utf-8" };

function decide(name: string, status = 200, headers: Record<string, string> = HTML) {
  const html = fixture(name);
  const url = "https://example.com/";
  return {
    signals: computeSignals(url, status, headers, html),
    decision: decideEscalation(status, headers["content-type"] ?? null, computeSignals(url, status, headers, html)),
  };
}

describe("challenge pages route to tier 2, never tier 1", () => {
  it("detects a Cloudflare interstitial served at HTTP 200", () => {
    // The whole point: this page returns 200 with ~120 chars of text. Every
    // "looks empty -> use a browser" heuristic would escalate it to Chromium,
    // which fails the same challenge. It must go to tier 2 instead.
    const { signals, decision } = decide("cloudflare-challenge.html", 200);
    expect(signals.challenge.isChallenge).toBe(true);
    expect(signals.challenge.vendor).toBe("cloudflare");
    expect(signals.visibleTextLength).toBeLessThan(500);
    expect(decision.action).toBe("tier2");
  });

  it("treats a 403 from a Cloudflare-fronted host as a challenge", () => {
    const { decision } = decide("plain-html-company.html", 403, {
      ...HTML,
      server: "cloudflare",
    });
    expect(decision.action).toBe("tier2");
  });

  it("routes a cf-mitigated header to tier 2 regardless of body", () => {
    const { decision } = decide("plain-html-company.html", 200, {
      ...HTML,
      "cf-mitigated": "challenge",
    });
    expect(decision.action).toBe("tier2");
  });
});

describe("genuine JS shells escalate to tier 1", () => {
  it("escalates an empty SPA root mount", () => {
    const { signals, decision } = decide("spa-shell.html");
    expect(signals.challenge.isChallenge).toBe(false);
    expect(decision.action).toBe("tier1");
  });
});

describe("server-rendered pages stay at tier 0", () => {
  it("keeps a plain HTML company site", () => {
    const { decision } = decide("plain-html-company.html");
    expect(decision.action).toBe("keep");
  });

  it("keeps a JSON-LD company page", () => {
    const { decision } = decide("jsonld-company.html");
    expect(decision.action).toBe("keep");
  });

  it("does not escalate non-HTML content", () => {
    const { decision } = decide("plain-html-company.html", 200, {
      "content-type": "application/json",
    });
    expect(decision.action).toBe("keep");
  });
});

describe("contact pages with no contact affordance escalate", () => {
  it("escalates a long contact page carrying no mailto, tel, or form", () => {
    const html = `<html><body><main>${"Reach out to our team about partnerships. ".repeat(40)}</main></body></html>`;
    const url = "https://example.com/kontakt";
    const signals = computeSignals(url, 200, HTML, html);
    expect(signals.isContactLikePath).toBe(true);
    expect(signals.hasContactAffordance).toBe(false);
    expect(decideEscalation(200, HTML["content-type"], signals).action).toBe("tier1");
  });
});
