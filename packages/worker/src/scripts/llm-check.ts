import { RequirementsSchema, type Requirements } from "@lead/core";
import { processDomain } from "../pipeline/domain.js";
import { assertProviderConfigured, resolveSpec } from "../llm/provider.js";

/**
 * Standalone smoke test for the LLM extraction path. No DB, no queue.
 *
 *   npm run check:llm -w @lead/worker -- https://example.com [https://another.com ...]
 *
 * cache_read is expected to be 0 on Gemini: the shared prompt prefix is ~1.5k
 * tokens and Gemini's implicit cache needs 4096, so it never engages. Only treat
 * a zero as a bug on a provider whose cache threshold the prefix actually clears.
 */

const REQUIREMENTS: Requirements = RequirementsSchema.parse({
  industry: "AI startups",
  countries: ["Germany"],
  cities: [],
  employee_min: 20,
  employee_max: 100,
  founded_after: null,
  funding_required: true,
  funding_since_year: 2024,
  keywords: ["machine learning", "artificial intelligence"],
  exclusions: ["consultancy", "staffing agency"],
});

async function main(): Promise<void> {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error("usage: tsx src/scripts/llm-check.ts <url> [url ...]");
    process.exit(1);
  }
  try {
    assertProviderConfigured("extract");
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const spec = resolveSpec("extract");
  console.log(`model: ${spec.provider}/${spec.model}\n`);

  for (const url of urls) {
    const domain = new URL(url).hostname.replace(/^www\./, "");
    console.log(`── ${domain} ${"─".repeat(Math.max(0, 60 - domain.length))}`);

    const started = Date.now();
    const result = await processDomain({ domain, seedUrl: url, requirements: REQUIREMENTS });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    console.log(`outcome    ${result.outcome}${result.note ? ` (${result.note})` : ""}`);
    console.log(`pages      ${result.pages.length}, max tier ${result.maxTier}, ${elapsed}s`);
    for (const p of result.pages) {
      const detail = p.error ?? p.escalationReason ?? "";
      console.log(`  [${p.kind}] tier=${p.tier} ${p.statusCode ?? "-"} ${p.finalUrl} ${detail}`);
    }

    const u = result.usage;
    console.log(
      `tokens     in=${u.input} out=${u.output} cache_read=${u.cacheRead} cache_write=${u.cacheWrite}`,
    );

    const lead = result.lead;
    if (lead) {
      console.log(`name       ${lead.companyName ?? "-"}`);
      console.log(`industry   ${lead.industry ?? "-"}`);
      console.log(`location   ${[lead.city, lead.country].filter(Boolean).join(", ") || "-"}`);
      console.log(`size       ${lead.employeeCount ?? lead.employeeRange ?? "-"}`);
      console.log(`founded    ${lead.foundedYear ?? "-"}`);
      console.log(
        `funding    ${[lead.fundingStage, lead.fundingAmount, lead.fundingYear].filter(Boolean).join(" / ") || "-"}`,
      );
      console.log(`emails     ${lead.emails.join(", ") || "-"}`);
      console.log(`phones     ${lead.phones.join(", ") || "-"}`);
      console.log(`people     ${lead.people.map((p) => `${p.name} (${p.role ?? "?"})`).join(", ") || "-"}`);
      console.log(`match      ${lead.matchesRequirements} — ${lead.matchReason}`);
      console.log(`confidence ${lead.llmConfidence}`);
      console.log(`provenance ${Object.keys(lead.provenance).length} fields recorded`);
    }
    console.log();
  }

  process.exit(0);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
