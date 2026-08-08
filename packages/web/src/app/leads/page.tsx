import Link from "next/link";
import type { Metadata } from "next";
import { listRuns, listShippableLeads, type LeadRow } from "@lead/core";
import { EmptyState, ErrorNote } from "@/components/primitives";
import { LeadTable } from "@/components/lead-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leads" };

type Search = Promise<{
  run?: string;
  q?: string;
  min?: string;
  sort?: string;
  dir?: string;
}>;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const sp = await searchParams;

  let runs;
  try {
    runs = await listRuns(50);
  } catch (err) {
    return (
      <ErrorNote>
        Could not read the database:{" "}
        {err instanceof Error ? err.message : String(err)}
      </ErrorNote>
    );
  }

  /* With no run named in the URL, prefer the newest completed one — an in-flight
     run's lead list changes under the reader, which is the wrong thing to land
     on. Falls back to the newest run of any status when none have finished. */
  const runId =
    sp.run ?? runs.find((r) => r.status === "completed")?.id ?? runs[0]?.id ?? null;
  const leads = runId ? await listShippableLeads(runId) : [];
  const filtered = filter(leads, sp.q ?? "", Number(sp.min ?? 0));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="text-3xl sm:text-4xl">Leads</h1>
          <p className="caption mt-1.5 text-sm">
            {runId
              ? `${filtered.length} of ${leads.length} leads, duplicates already merged.`
              : "No runs to show leads from yet."}
          </p>
        </div>
        {runId && filtered.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            <Button asChild size="sm">
              <a href={`/runs/${runId}/export?format=csv`}>Export CSV</a>
            </Button>
            <Button asChild size="sm">
              <a href={`/runs/${runId}/export?format=json`}>Export JSON</a>
            </Button>
          </div>
        ) : null}
      </div>

      {runs.length === 0 ? (
        <div className="ink-card overflow-hidden">
          <EmptyState title="No runs yet">
            <Link href="/" className="font-semibold underline underline-offset-4">
              Plan a run
            </Link>{" "}
            to start collecting leads.
          </EmptyState>
        </div>
      ) : (
        <div className="space-y-6">
          {/* A plain GET form: the filter state lives in the URL, so a filtered
              view is linkable and survives the auto-refresh on a live run. That
              also keeps the run picker a native <select> — Radix's version
              renders a button and would not submit with the form. */}
          <form
            method="get"
            className="ink-card flex flex-wrap items-end gap-4 bg-cream p-5"
          >
            <div className="flex min-w-56 flex-[2] flex-col gap-2">
              <Label htmlFor="run">Run</Label>
              <select
                id="run"
                name="run"
                defaultValue={runId ?? ""}
                className="ink-input ink-select h-10 py-0 text-sm"
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.query.slice(0, 70)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex min-w-48 flex-[2] flex-col gap-2">
              <Label htmlFor="q">Search</Label>
              <Input
                id="q"
                name="q"
                defaultValue={sp.q ?? ""}
                placeholder="Company, city, email, technology"
                className="h-10 py-0"
              />
            </div>

            <div className="flex min-w-28 flex-1 flex-col gap-2">
              <Label htmlFor="min">Minimum score</Label>
              <Input
                id="min"
                name="min"
                type="number"
                min={0}
                max={100}
                step={5}
                defaultValue={sp.min ?? ""}
                className="h-10 py-0"
              />
            </div>

            <Button variant="primary" type="submit">
              Apply
            </Button>
          </form>

          <LeadTable leads={filtered} />
        </div>
      )}
    </div>
  );
}

/**
 * Filtering happens here rather than in SQL because a run's lead set is bounded
 * by the plan's approved target — low hundreds, already in memory for the count.
 * A LIKE query per keystroke would cost more than it saves at this size.
 */
function filter(leads: LeadRow[], q: string, min: number): LeadRow[] {
  const needle = q.trim().toLowerCase();
  return leads.filter((lead) => {
    if (Number.isFinite(min) && min > 0 && lead.score < min) return false;
    if (!needle) return true;
    return [
      lead.company_name,
      lead.domain,
      lead.industry,
      lead.city,
      lead.country,
      lead.description,
      ...lead.emails,
      ...lead.technologies,
    ]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(needle));
  });
}
