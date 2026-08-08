"use client";

import { useMemo, useState } from "react";
import type { LeadRow } from "@lead/core";
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
import { cn } from "@/lib/utils";
import { EmptyState, Eyebrow } from "./primitives";

/**
 * The lead table.
 *
 * Sortable columns carry `aria-sort` and are real buttons, so the sort is
 * reachable and announced without a mouse. Each row expands to its provenance —
 * where every field came from and by what method — because a lead list that
 * cannot be checked is a lead list nobody acts on.
 */

type SortKey = "score" | "company_name" | "employee_count" | "country";

const COLUMNS: { key: SortKey | null; label: string; align?: "right" }[] = [
  { key: "score", label: "Score", align: "right" },
  { key: "company_name", label: "Company" },
  { key: null, label: "Contact" },
  { key: "employee_count", label: "Size", align: "right" },
  { key: "country", label: "Location" },
  { key: null, label: "Industry" },
];

export function LeadTable({ leads }: { leads: LeadRow[] }) {
  const [sort, setSort] = useState<SortKey>("score");
  const [desc, setDesc] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const sorted = useMemo(() => rank(leads, sort, desc), [leads, sort, desc]);

  if (leads.length === 0) {
    return (
      <div className="ink-card overflow-hidden">
        <EmptyState title="No leads match">
          Widen the score threshold or clear the search to see more.
        </EmptyState>
      </div>
    );
  }

  /* Re-sorting on the same column flips direction; a new column starts in the
     direction that is useful for it — numbers high-first, names A–Z. */
  const toggle = (key: SortKey) => {
    if (key === sort) {
      setDesc(!desc);
    } else {
      setSort(key);
      setDesc(key === "score" || key === "employee_count");
    }
  };

  return (
    <div className="ink-card overflow-hidden">
      <Table>
        <TableCaption className="sr-only">
          Leads, sorted by {sort}, {desc ? "descending" : "ascending"}
        </TableCaption>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((col) => (
              <TableHead
                key={col.label}
                scope="col"
                className={col.align === "right" ? "text-right" : undefined}
                aria-sort={
                  col.key === null
                    ? undefined
                    : col.key === sort
                      ? desc
                        ? "descending"
                        : "ascending"
                      : "none"
                }
              >
                {col.key ? (
                  <button
                    type="button"
                    onClick={() => toggle(col.key as SortKey)}
                    className={cn(
                      "cursor-pointer font-[inherit] tracking-[inherit] uppercase",
                      col.key === sort && "text-blue",
                    )}
                  >
                    {col.label}
                    {col.key === sort ? (desc ? " ↓" : " ↑") : ""}
                  </button>
                ) : (
                  col.label
                )}
              </TableHead>
            ))}
            <TableHead scope="col">
              <span className="sr-only">Provenance</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((lead) => (
            <Row
              key={lead.id}
              lead={lead}
              open={open === lead.id}
              onToggle={() => setOpen(open === lead.id ? null : lead.id)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Row({
  lead,
  open,
  onToggle,
}: {
  lead: LeadRow;
  open: boolean;
  onToggle: () => void;
}) {
  const contact = lead.emails[0] ?? lead.phones[0] ?? null;

  return (
    <>
      <TableRow>
        <TableCell
          className={cn(
            "text-right text-base font-bold tabular-nums",
            scoreClass(lead.score),
          )}
        >
          {lead.score}
        </TableCell>
        <TableCell className="whitespace-normal">
          <a
            href={lead.website ?? `https://${lead.domain}`}
            target="_blank"
            rel="noreferrer noopener"
            className="font-semibold underline-offset-4 hover:underline"
          >
            {lead.company_name ?? lead.domain}
          </a>
          <div className="caption mono text-xs">{lead.domain}</div>
          {lead.merged_domains.length > 0 ? (
            <div className="caption text-xs">
              merged: {lead.merged_domains.join(", ")}
            </div>
          ) : null}
        </TableCell>
        <TableCell>
          {contact ? (
            <span className="mono text-xs">{contact}</span>
          ) : lead.contact_form_url ? (
            /* A form-only site is a different outcome from no contact at all —
               it is reachable, just not by email, so it stays actionable. */
            <a
              href={lead.contact_form_url}
              target="_blank"
              rel="noreferrer noopener"
              className="caption text-xs underline underline-offset-4"
            >
              contact form
            </a>
          ) : (
            <span className="caption text-xs">none found</span>
          )}
        </TableCell>
        <TableCell className="caption text-right tabular-nums">
          {lead.employee_count ?? lead.employee_range ?? "—"}
        </TableCell>
        <TableCell className="caption">
          {[lead.city, lead.country].filter(Boolean).join(", ") || "—"}
        </TableCell>
        <TableCell className="caption max-w-48 truncate">
          {lead.industry ?? "—"}
        </TableCell>
        <TableCell>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onToggle}
            aria-expanded={open}
          >
            {open ? "Hide" : "Details"}
          </Button>
        </TableCell>
      </TableRow>

      {open ? (
        <TableRow>
          <TableCell colSpan={7} className="bg-cream whitespace-normal">
            <div className="flex flex-col gap-5 py-2">
              {lead.match_reason ? (
                <p className="text-sm font-semibold">{lead.match_reason}</p>
              ) : null}
              {lead.description ? (
                <p className="caption text-sm leading-relaxed">
                  {lead.description}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-x-10 gap-y-4">
                <Detail label="Emails" value={lead.emails.join(", ")} />
                <Detail label="Phones" value={lead.phones.join(", ")} />
                <Detail label="Founded" value={lead.founded_year} />
                <Detail
                  label="Funding"
                  value={[
                    lead.funding_stage,
                    lead.funding_amount,
                    lead.funding_year,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
                <Detail
                  label="Technologies"
                  value={lead.technologies.join(", ")}
                />
              </div>

              <div>
                <Eyebrow>Score breakdown</Eyebrow>
                <div className="mt-2 flex flex-wrap gap-x-10 gap-y-4">
                  {Object.entries(lead.score_breakdown).map(([k, v]) => (
                    <Detail
                      key={k}
                      label={k}
                      value={typeof v === "number" ? v.toFixed(2) : String(v)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <Eyebrow>Provenance</Eyebrow>
                <ul className="mt-2 flex flex-col gap-1">
                  {Object.entries(lead.provenance).map(([field, p]) => (
                    <li key={field} className="caption mono text-xs">
                      {field} · {p.method} · {p.confidence.toFixed(2)} ·{" "}
                      <a
                        href={p.source_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline underline-offset-2"
                      >
                        {p.source_url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}

/* Green flags a lead worth calling today, muted greys one that needs a look
   first. The number itself is always shown, so the colour only reinforces. */
function scoreClass(score: number): string {
  if (score >= 70) return "text-green";
  if (score >= 40) return "text-ink";
  return "text-muted-foreground";
}

function rank(leads: LeadRow[], key: SortKey, desc: boolean): LeadRow[] {
  const dir = desc ? -1 : 1;
  return [...leads].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    // Nulls sort last in both directions. A company with no headcount is not
    // "smaller than everyone" — it is unknown, and it belongs at the bottom.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}
