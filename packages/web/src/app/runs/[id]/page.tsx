import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRun, listDomains, listEvents, listShippableLeads } from "@lead/core";
import { ApprovalGate, CancelButton } from "@/components/approval-gate";
import { AutoRefresh } from "@/components/auto-refresh";
import {
  EmptyState,
  ErrorNote,
  Eyebrow,
  Progress,
  Stat,
  StatusBadge,
} from "@/components/primitives";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isActive } from "@/lib/control";
import {
  domainTone,
  formatDate,
  formatDuration,
  runLabel,
  runTone,
} from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Run" };

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();

  const [domains, events, leads] = await Promise.all([
    listDomains(id),
    listEvents(id, 60),
    listShippableLeads(id),
  ]);

  const active = isActive(run.status);

  return (
    <div className="space-y-10">
      <AutoRefresh active={active} />

      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <Link
            href="/"
            className="caption mono text-[0.62rem] font-bold tracking-[0.16em] uppercase underline-offset-4 hover:underline"
          >
            ← All runs
          </Link>
          <h1 className="mt-2 text-3xl sm:text-4xl">{run.query}</h1>
          <p className="caption mt-1.5 text-sm">
            Started {formatDate(run.created_at)} · ran for{" "}
            {formatDuration(run.approved_at, run.finished_at)}
          </p>
        </div>
        <div className="flex flex-none items-center gap-3">
          <StatusBadge tone={runTone(run.status)}>
            {runLabel(run.status)}
          </StatusBadge>
          {active ? <CancelButton runId={run.id} /> : null}
        </div>
      </div>

      {run.error ? <ErrorNote>{run.error}</ErrorNote> : null}

      {run.status === "awaiting_approval" && run.plan ? (
        <ApprovalGate runId={run.id} plan={run.plan} />
      ) : null}

      {run.domains_total > 0 ? (
        <section className="space-y-4">
          <Progress done={run.domains_done} total={run.domains_total} />
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Domains scraped"
              value={`${run.domains_done}/${run.domains_total}`}
            />
            <Stat label="Leads found" value={leads.length} />
            <Stat label="Pages fetched" value={run.pages_fetched} />
            {/* Tier 1 is Chromium and tier 2 is a paid provider, so this number
                is the run's real cost driver — worth its own stat rather than
                being buried in the domain table. */}
            <Stat
              label="Browser pages"
              value={run.tier1_pages + run.tier2_pages}
              note="Escalated past plain HTTP"
            />
          </dl>
        </section>
      ) : null}

      {leads.length > 0 ? (
        <section className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-2xl">
            {leads.length} {leads.length === 1 ? "lead" : "leads"}
          </h2>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="sm">
              <a href={`/runs/${run.id}/export?format=csv`}>Export CSV</a>
            </Button>
            <Button asChild size="sm">
              <a href={`/runs/${run.id}/export?format=json`}>Export JSON</a>
            </Button>
            <Button asChild size="sm" variant="primary">
              <Link href={`/leads?run=${run.id}`}>View leads</Link>
            </Button>
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="ink-card overflow-hidden">
          {domains.length === 0 ? (
            <EmptyState title="No domains yet">
              Domains appear here once the plan is approved and discovery has
              run.
            </EmptyState>
          ) : (
            <Table>
              <TableCaption className="sr-only">
                Domains in this run
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Domain</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Outcome</TableHead>
                  <TableHead scope="col">Pages</TableHead>
                  <TableHead scope="col">Tier</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="mono text-xs">{d.domain}</TableCell>
                    <TableCell>
                      <StatusBadge tone={domainTone(d.status)}>
                        {d.status}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="caption">{d.outcome ?? "—"}</TableCell>
                    <TableCell className="caption tabular-nums">
                      {d.pages}
                    </TableCell>
                    <TableCell className="caption tabular-nums">
                      {d.max_tier}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section className="ink-card flex flex-col gap-4 p-6">
          <Eyebrow>Activity</Eyebrow>
          {events.length === 0 ? (
            <p className="caption text-sm">Nothing logged yet.</p>
          ) : (
            <ol className="flex max-h-96 flex-col gap-2.5 overflow-y-auto">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="grid grid-cols-[3.5rem_4.5rem_1fr] items-baseline gap-2.5 text-xs"
                >
                  <span className="caption mono tabular-nums">
                    {formatDate(e.created_at).split(", ")[1] ?? ""}
                  </span>
                  <span className="mono text-[0.6rem] font-bold tracking-[0.12em] uppercase opacity-60">
                    {e.stage}
                  </span>
                  <span
                    className={
                      e.level === "error"
                        ? "font-semibold text-red"
                        : e.level === "warn"
                          ? "font-semibold text-[#8a6100]"
                          : undefined
                    }
                  >
                    {e.level !== "info" ? `${e.level}: ` : ""}
                    {e.message}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
