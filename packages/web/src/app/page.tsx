import Link from "next/link";
import { listRuns } from "@lead/core";
import { NewRunForm } from "@/components/new-run-form";
import {
  EmptyState,
  ErrorNote,
  Progress,
  StatusBadge,
} from "@/components/primitives";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, runLabel, runTone } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  let runs;
  try {
    runs = await listRuns(50);
  } catch (err) {
    return (
      <div className="space-y-8">
        <PageHead />
        <ErrorNote>
          Could not read the database:{" "}
          {err instanceof Error ? err.message : String(err)}
        </ErrorNote>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <PageHead />
      <NewRunForm />

      <section className="ink-card overflow-hidden">
        {runs.length === 0 ? (
          <EmptyState title="No runs yet">
            Describe an ideal customer above and the planner turns it into a
            search plan for you to approve.
          </EmptyState>
        ) : (
          <Table>
            <TableCaption className="sr-only">
              Recent lead-generation runs
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Query</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Progress</TableHead>
                <TableHead scope="col">Domains</TableHead>
                <TableHead scope="col">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="max-w-sm">
                    {/* The query cell is the link, not the whole row. A row-wide
                        anchor makes the text unselectable, and operators copy
                        queries out of this table constantly. */}
                    <Link
                      href={`/runs/${run.id}`}
                      className="block truncate font-semibold underline-offset-4 hover:underline"
                      title={run.query}
                    >
                      {run.query}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={runTone(run.status)}>
                      {runLabel(run.status)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="w-36 min-w-32">
                    <Progress
                      done={run.domains_done}
                      total={run.domains_total}
                    />
                  </TableCell>
                  <TableCell className="caption tabular-nums">
                    {run.domains_done}/{run.domains_total || "—"}
                  </TableCell>
                  <TableCell className="caption">
                    {formatDate(run.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function PageHead() {
  return (
    <div>
      <h1 className="text-3xl sm:text-4xl">Runs</h1>
      <p className="caption mt-1.5 text-sm">
        Every search this engine has planned or executed.
      </p>
    </div>
  );
}
