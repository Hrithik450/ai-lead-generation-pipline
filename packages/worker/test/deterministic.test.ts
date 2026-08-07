import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeCfEmail } from "../src/extract/cfemail.js";
import { extractDeterministic, isRoleEmail } from "../src/extract/deterministic.js";
import { classifyLink, selectPages } from "../src/extract/link-discovery.js";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

// Fixtures use role addresses; the personal-email gate is exercised separately.
beforeAll(() => {
  process.env.ALLOW_PERSONAL_EMAILS = "false";
});

describe("Cloudflare email obfuscation", () => {
  it("decodes a data-cfemail payload", () => {
    expect(decodeCfEmail("3d55585151527d5f4f545a55494d5c4955135452")).toBe("hello@brightpath.io");
  });

  it("rejects garbage rather than emitting a fake address", () => {
    expect(decodeCfEmail("zzzz")).toBeNull();
    expect(decodeCfEmail("00")).toBeNull();
    expect(decodeCfEmail("3d3d3d3d")).toBeNull();
  });

  it("recovers the email from a page where both fetch tiers would find nothing", () => {
    const r = extractDeterministic(fixture("cfemail-contact.html"), "https://brightpath.io/contact", "contact");
    expect(r.emails.map((e) => e.value)).toContain("hello@brightpath.io");
    expect(r.emails[0]?.method).toBe("cfemail");
    expect(r.phones.map((p) => p.value)[0]).toContain("+44");
  });

  it("does not report form-only contact when an obfuscated email was recovered", () => {
    const r = extractDeterministic(fixture("cfemail-contact.html"), "https://brightpath.io/contact", "contact");
    expect(r.contactFormUrl).not.toBeNull();
    expect(r.formOnlyContact).toBe(false);
  });
});

describe("German Impressum", () => {
  it("extracts the legally-required company block", () => {
    const r = extractDeterministic(fixture("german-impressum.html"), "https://nordlicht-ai.de/impressum", "imprint");
    expect(r.companyName).toBe("Nordlicht AI GmbH");
    expect(r.emails.map((e) => e.value)).toContain("info@nordlicht-ai.de");
    expect(r.phones.length).toBeGreaterThan(0);
    expect(r.address).toContain("Hamburg");
    expect(r.foundedYear).toBe(2021);
    expect(r.socials.linkedin).toContain("linkedin.com/company/nordlicht-ai");
  });
});

describe("JSON-LD structured data", () => {
  it("reads an Organization node out of an @graph wrapper", () => {
    const r = extractDeterministic(fixture("jsonld-company.html"), "https://vantagerobotics.nl/", "home");
    expect(r.companyName).toBe("Vantage Robotics BV");
    expect(r.emails.map((e) => e.value)).toEqual(
      expect.arrayContaining(["info@vantagerobotics.nl", "sales@vantagerobotics.nl"]),
    );
    expect(r.city).toBe("Amsterdam");
    expect(r.country).toBe("NL");
    expect(r.foundedYear).toBe(2019);
    expect(r.socials.linkedin).toBeDefined();
    expect(r.socials.github).toBeDefined();
  });

  it("marks JSON-LD-sourced fields with jsonld provenance", () => {
    const r = extractDeterministic(fixture("jsonld-company.html"), "https://vantagerobotics.nl/", "home");
    expect(r.emails.every((e) => e.method === "jsonld")).toBe(true);
  });
});

describe("email hygiene", () => {
  it("classifies role vs. named addresses", () => {
    expect(isRoleEmail("info@acme.com")).toBe(true);
    expect(isRoleEmail("kontakt@acme.de")).toBe(true);
    expect(isRoleEmail("sales+eu@acme.com")).toBe(true);
    expect(isRoleEmail("lena.brandt@acme.de")).toBe(false);
  });

  it("drops image filenames, placeholders, and free-mail domains", () => {
    const html = `<html><body>
      <a href="mailto:logo@2x.png">x</a>
      <a href="mailto:your@example.com">x</a>
      <a href="mailto:info@gmail.com">x</a>
      <a href="mailto:info@realcompany.com">x</a>
    </body></html>`;
    const r = extractDeterministic(html, "https://realcompany.com/contact", "contact");
    expect(r.emails.map((e) => e.value)).toEqual(["info@realcompany.com"]);
  });

  // Regression: cheerio's .text() joins adjacent nodes with no separator, so the
  // regex ran past the TLD into the next element and produced addresses like
  // "info@acme.deImpressum". Seen live on langdock.com and parloa.com.
  it("does not fuse an address with the text of the following element", () => {
    const html = `<html><body>
      <p><a href="/x">info@acme.de</a><span>Impressum</span></p>
      <div>kontakt@acme.de</div><div>Handelsregister</div>
    </body></html>`;
    const r = extractDeterministic(html, "https://acme.de/impressum", "imprint");
    expect(r.emails.map((e) => e.value).sort()).toEqual(["info@acme.de", "kontakt@acme.de"]);
  });

  it("keeps element boundaries out of the packed page text", () => {
    const html = `<html><body><div>Team of 34</div><div>engineers</div></body></html>`;
    const r = extractDeterministic(html, "https://acme.de/about", "about");
    expect(r.cleanText).toBe("Team of 34 engineers");
  });
});

describe("form-only contact", () => {
  it("is recorded as a distinct outcome from nothing-found", () => {
    const html = `<html><body><form><input name="email"><textarea name="message"></textarea></form></body></html>`;
    const r = extractDeterministic(html, "https://acme.com/contact", "contact");
    expect(r.emails).toHaveLength(0);
    expect(r.formOnlyContact).toBe(true);
    expect(r.contactFormUrl).toBe("https://acme.com/contact");
  });
});

describe("link discovery by anchor text, not path guessing", () => {
  it("classifies German page names that path-guessing would miss", () => {
    expect(classifyLink("https://a.de/impressum", "Impressum").kind).toBe("imprint");
    expect(classifyLink("https://a.de/ueber-uns", "Über uns").kind).toBe("about");
    expect(classifyLink("https://a.de/kontakt", "Kontakt").kind).toBe("contact");
    expect(classifyLink("https://a.de/karriere", "Karriere").kind).toBe("careers");
  });

  it("classifies by anchor text when the href is opaque", () => {
    expect(classifyLink("https://a.com/p/8821", "Our team").kind).toBe("team");
    expect(classifyLink("https://a.com/x", "Get in touch").kind).toBe("contact");
  });

  it("ranks the Impressum above careers", () => {
    const links = [
      { url: "https://a.de/karriere", kind: "careers" as const, priority: 40, label: "Karriere" },
      { url: "https://a.de/impressum", kind: "imprint" as const, priority: 100, label: "Impressum" },
    ];
    expect(selectPages(links, 1)[0]?.kind).toBe("imprint");
  });

  it("takes at most one page per kind", () => {
    const links = [
      { url: "https://a.de/kontakt", kind: "contact" as const, priority: 90, label: "Kontakt" },
      { url: "https://a.de/contact", kind: "contact" as const, priority: 90, label: "Contact" },
      { url: "https://a.de/impressum", kind: "imprint" as const, priority: 100, label: "Impressum" },
    ];
    const chosen = selectPages(links, 5);
    expect(chosen).toHaveLength(2);
  });

  it("finds the discoverable pages on a real homepage", () => {
    const r = extractDeterministic(fixture("german-impressum.html"), "https://nordlicht-ai.de/impressum", "imprint");
    const kinds = r.links.map((l) => l.kind);
    expect(kinds).toEqual(expect.arrayContaining(["about", "contact", "imprint"]));
  });
});
