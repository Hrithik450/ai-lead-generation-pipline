"use client";

import { useActionState } from "react";
import { startRunAction, type ActionState } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorNote } from "./primitives";

const INITIAL: ActionState = { error: null };

const EXAMPLE =
  "AI startups in Germany with 20-100 employees that raised funding in the last 2 years";

/**
 * The run composer.
 *
 * Submitting costs one cheap planning call and stops at the approval gate — no
 * search credits and no scraping until the plan is reviewed. The button says
 * "Plan run" rather than "Start" for exactly that reason, and the note beside it
 * repeats it in words, because the cost of a mistaken click here is real money.
 */
export function NewRunForm() {
  const [state, action, pending] = useActionState(startRunAction, INITIAL);

  return (
    <form action={action} className="ink-card flex flex-col gap-4 bg-cream p-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="query">Describe the companies you want to find</Label>
        <Input
          id="query"
          name="query"
          placeholder={EXAMPLE}
          disabled={pending}
          required
          autoComplete="off"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="caption text-xs">
          Planning is cheap and stops for your approval before anything is
          scraped.
        </p>
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? "Planning…" : "Plan run"}
        </Button>
      </div>

      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}
    </form>
  );
}
