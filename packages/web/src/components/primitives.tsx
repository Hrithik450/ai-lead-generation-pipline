import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "danger" | "info" | "idle";

/**
 * A status pill.
 *
 * Thin wrapper over the shadcn Badge so call sites pass the tone that
 * `lib/format.ts` computes without restating the variant mapping. The label is
 * always rendered — the tone reinforces it and never replaces it.
 */
export function StatusBadge({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  return <Badge variant={tone}>{children}</Badge>;
}

/**
 * The empty state.
 *
 * Every surface gets a real one. A blank panel reads as broken, and "nothing
 * matched your filter" and "this run found nothing" are different situations
 * needing different next steps — so the caller supplies both the headline and
 * what to do about it.
 */
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-6 py-16 text-center">
      <h3 className="text-2xl">{title}</h3>
      {children ? (
        <div className="caption mx-auto mt-2 max-w-md text-sm">{children}</div>
      ) : null}
    </div>
  );
}

/* role="alert" so a failure announced after a server action reaches a screen
   reader without the user having to go looking for it. */
export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="ink-card border-l-[6px] border-l-red px-4 py-3 text-sm font-semibold"
    >
      {children}
    </p>
  );
}

export function Stat({
  label,
  value,
  note,
  className,
}: {
  label: string;
  value: string | number;
  note?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("rounded-2xl border-2 border-ink bg-cream p-4", className)}
    >
      <dt className="mono text-[0.62rem] font-bold tracking-[0.16em] uppercase opacity-60">
        {label}
      </dt>
      <dd className="mt-1 text-2xl leading-none font-bold tabular-nums">
        {value}
      </dd>
      {note ? <p className="caption mt-1.5 text-xs">{note}</p> : null}
    </div>
  );
}

/**
 * A progress bar that is also readable without seeing it.
 *
 * The bar itself is decorative; the accessible name carries the same numbers, so
 * a screen reader hears "38 of 120 domains processed" rather than an unlabelled
 * percentage. aria-valuemax tracks the real total rather than 100, so the raw
 * counts are what get announced.
 */
export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div
      className="h-3 overflow-hidden rounded-full border-2 border-ink bg-white"
      role="progressbar"
      aria-valuenow={done}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={`${done} of ${total} domains processed`}
    >
      <div
        className="h-full bg-green transition-[width] duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** The small tracked-out mono label used above a value or a group. */
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "mono text-[0.62rem] font-bold tracking-[0.16em] uppercase opacity-60",
        className,
      )}
    >
      {children}
    </span>
  );
}
