import { getRun, listShippableLeads, type LeadRow } from "@lead/core";

/**
 * Lead export.
 *
 * Reads through `listShippableLeads`, which excludes rows dedupe folded into
 * another company. Exporting the raw table would ship the same company two or
 * three times under different domains, which is the single most visible way a
 * lead list loses trust.
 */

const COLUMNS = [
  "company_name",
  "domain",
  "website",
  "score",
  "industry",
  "country",
  "city",
  "address",
  "employee_count",
  "employee_range",
  "founded_year",
  "funding_stage",
  "funding_amount",
  "funding_year",
  "emails",
  "phones",
  "linkedin",
  "technologies",
  "contact_form_url",
  "match_reason",
  "merged_domains",
  "description",
] as const;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) return new Response("run not found", { status: 404 });

  const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "json";
  const leads = await listShippableLeads(id);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `leads-${id.slice(0, 8)}-${stamp}.${format}`;

  const body =
    format === "csv"
      ? toCsv(leads)
      : JSON.stringify(
          { run: { id: run.id, query: run.query, finished_at: run.finished_at }, leads },
          null,
          2,
        );

  return new Response(body, {
    headers: {
      "content-type":
        format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

function toCsv(leads: LeadRow[]): string {
  const rows = leads.map((lead) => COLUMNS.map((c) => csvCell(value(lead, c))).join(","));
  // Excel reads a bare UTF-8 CSV as Latin-1 and mangles every umlaut in a German
  // lead list. The BOM is what makes it open correctly on a double-click.
  return "﻿" + [COLUMNS.join(","), ...rows].join("\r\n");
}

function value(lead: LeadRow, column: (typeof COLUMNS)[number]): unknown {
  if (column === "linkedin") return lead.socials?.linkedin ?? "";
  return lead[column as keyof LeadRow];
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = Array.isArray(value) ? value.join("; ") : String(value);

  // A cell starting with = + - @ is executed as a formula when the file is opened
  // in Excel or Sheets. Company names and scraped text routinely start with "+",
  // so prefixing with a tab neutralises it without altering the visible value.
  const safe = /^[=+\-@\t\r]/.test(raw) ? `\t${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
