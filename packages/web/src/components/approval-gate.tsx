"use client";

import { useActionState } from "react";
import type { Plan } from "@lead/core";
import {
  approveRunAction,
  cancelRunAction,
  type ActionState,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Eyebrow, ErrorNote } from "./primitives";

const INITIAL: ActionState = { error: null };

/**
 * The approval gate.
 *
 * This is the one screen in the product where a click costs money — approving
 * spends search credits and then one LLM call per domain. So the plan is shown
 * in full first: what the planner understood, what it will search for, how many
 * domains it will scrape, and what it thinks could go wrong. The button is the
 * last thing on the card, not the first, and it names the number it is spending
 * against rather than just saying "Approve".
 */
export function ApprovalGate({ runId, plan }: { runId: string; plan: Plan }) {
  const [state, action, pending] = useActionState(approveRunAction, INITIAL);
  const req = plan.requirements;

  return (
    <section
      className="ink-card flex flex-col gap-6 p-6"
      aria-labelledby="gate-heading"
    >
      <div>
        <span className="sticker bg-yellow">Awaiting approval</span>
        <h2 id="gate-heading" className="mt-3 text-2xl">
          {plan.interpretation}
        </h2>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Facet label="Industry" value={req.industry} />
        <Facet label="Countries" value={req.countries.join(", ")} />
        <Facet
          label="Employees"
          value={
            req.employee_min || req.employee_max
              ? `${req.employee_min ?? "any"}–${req.employee_max ?? "any"}`
              : null
          }
        />
        <Facet label="Funded since" value={req.funding_since_year} />
      </dl>

      <div>
        <Eyebrow>
          {plan.search_queries.length} search queries · up to{" "}
          {plan.target_domains} domains
        </Eyebrow>
        <ul className="mt-3 flex flex-col gap-2">
          {plan.search_queries.map((q) => (
            <li
              key={q}
              className="mono rounded-lg border-2 border-ink bg-cream px-3 py-2 text-xs"
            >
              {q}
            </li>
          ))}
        </ul>
      </div>

      {plan.notes ? (
        <div>
          <Eyebrow>Before you approve</Eyebrow>
          <p className="caption mt-2 text-sm leading-relaxed">{plan.notes}</p>
        </div>
      ) : null}

      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t-2 border-ink pt-5">
        <p className="caption max-w-xs text-xs">
          Approving spends search credits and one extraction call per domain.
        </p>
        <div className="flex flex-wrap gap-3">
          <CancelButton runId={runId} label="Discard" />
          <form action={action}>
            <input type="hidden" name="runId" value={runId} />
            <Button variant="primary" type="submit" disabled={pending}>
              {pending
                ? "Starting…"
                : `Approve and scrape ${plan.target_domains} domains`}
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}

export function CancelButton({
  runId,
  label = "Cancel run",
}: {
  runId: string;
  label?: string;
}) {
  const [state, action, pending] = useActionState(cancelRunAction, INITIAL);

  return (
    <form action={action}>
      <input type="hidden" name="runId" value={runId} />
      <Button variant="destructive" type="submit" disabled={pending}>
        {pending ? "Cancelling…" : label}
      </Button>
      {state.error ? (
        <div className="mt-2">
          <ErrorNote>{state.error}</ErrorNote>
        </div>
      ) : null}
    </form>
  );
}

/* An unspecified facet reads "Any", not a dash. The planner leaving a field open
   is a deliberate widening of the search, and the operator has to be able to
   tell that apart from a value that failed to load. */
function Facet({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) {
  return (
    <div className="rounded-2xl border-2 border-ink bg-cream p-4">
      <dt className="mono text-[0.62rem] font-bold tracking-[0.16em] uppercase opacity-60">
        {label}
      </dt>
      <dd className="mt-1 text-lg leading-tight font-semibold">
        {value || <span className="caption font-normal">Any</span>}
      </dd>
    </div>
  );
}
