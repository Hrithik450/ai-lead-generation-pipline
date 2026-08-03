import { one, query } from "./client.js";
import type {
  DomainOutcome,
  DomainRow,
  DomainStatus,
  LeadRow,
  Plan,
  Requirements,
  RunEventRow,
  RunRow,
  RunStatus,
} from "../types.js";

export async function createRun(queryText: string): Promise<RunRow> {
  const row = await one<RunRow>(
    `INSERT INTO runs (query) VALUES ($1) RETURNING *`,
    [queryText],
  );
  return row!;
}

export function getRun(id: string): Promise<RunRow | undefined> {
  return one<RunRow>(`SELECT * FROM runs WHERE id = $1`, [id]);
}

export function listRuns(limit = 50): Promise<RunRow[]> {
  return query<RunRow>(`SELECT * FROM runs ORDER BY created_at DESC LIMIT $1`, [limit]);
}

export async function setRunPlan(id: string, plan: Plan): Promise<void> {
  await query(
    `UPDATE runs SET plan = $2, requirements = $3, status = 'awaiting_approval' WHERE id = $1`,
    [id, JSON.stringify(plan), JSON.stringify(plan.requirements)],
  );
}

export async function setRunStatus(
  id: string,
  status: RunStatus,
  error?: string | null,
): Promise<void> {
  const terminal = status === "completed" || status === "failed" || status === "cancelled";
  await query(
    `UPDATE runs
       SET status = $2,
           error = COALESCE($3, error),
           approved_at = CASE WHEN $2 = 'discovering' AND approved_at IS NULL THEN now() ELSE approved_at END,
           finished_at = CASE WHEN $4 THEN now() ELSE finished_at END
     WHERE id = $1`,
    [id, status, error ?? null, terminal],
  );
}

export async function setDomainsTotal(id: string, total: number): Promise<void> {
  await query(`UPDATE runs SET domains_total = $2 WHERE id = $1`, [id, total]);
}

/**
 * Counters live in Redis during a run (see worker/src/queue/counters.ts) and are
 * flushed here in one absolute write. Never use `done = done + 1` from N workers:
 * that serializes every worker on a single row lock.
 */
export async function flushRunCounters(
  id: string,
  c: {
    domains_done: number;
    domains_failed: number;
    pages_fetched: number;
    tier1_pages: number;
    tier2_pages: number;
    llm_input_tokens: number;
    llm_output_tokens: number;
    llm_cached_tokens: number;
  },
): Promise<void> {
  await query(
    `UPDATE runs SET
       domains_done = $2, domains_failed = $3, pages_fetched = $4,
       tier1_pages = $5, tier2_pages = $6,
       llm_input_tokens = $7, llm_output_tokens = $8, llm_cached_tokens = $9
     WHERE id = $1`,
    [
      id,
      c.domains_done,
      c.domains_failed,
      c.pages_fetched,
      c.tier1_pages,
      c.tier2_pages,
      c.llm_input_tokens,
      c.llm_output_tokens,
      c.llm_cached_tokens,
    ],
  );
}

export async function insertDomains(
  runId: string,
  domains: { domain: string; seed_url: string; source: string }[],
): Promise<DomainRow[]> {
  if (domains.length === 0) return [];
  const values: unknown[] = [runId];
  const tuples = domains.map((d, i) => {
    values.push(d.domain, d.seed_url, d.source);
    return `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`;
  });
  return query<DomainRow>(
    `INSERT INTO domains (run_id, domain, seed_url, source)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (run_id, domain) DO NOTHING
     RETURNING *`,
    values,
  );
}

export function listDomains(runId: string): Promise<DomainRow[]> {
  return query<DomainRow>(
    `SELECT * FROM domains WHERE run_id = $1 ORDER BY created_at ASC`,
    [runId],
  );
}

/**
 * Mark every not-yet-started domain of a run as skipped.
 *
 * Draining the queue removes the jobs but nothing ever touches their rows, so
 * they would sit at `queued` forever and the run could never be judged finished.
 * Scoped to `queued` on purpose: a domain already being worked on stops at its own
 * checkpoint and records its own outcome, and this must not overwrite that.
 */
export async function skipQueuedDomains(runId: string, note: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE domains SET status = 'skipped', note = $2, finished_at = now()
     WHERE run_id = $1 AND status = 'queued'
     RETURNING id`,
    [runId, note],
  );
  return rows.length;
}

export async function setDomainStatus(
  id: string,
  status: DomainStatus,
  fields: { outcome?: DomainOutcome; note?: string; pages?: number; max_tier?: number } = {},
): Promise<void> {
  const starting = status === "fetching";
  const terminal = status === "done" || status === "failed" || status === "blocked" || status === "skipped";
  await query(
    `UPDATE domains SET
       status = $2,
       outcome = COALESCE($3, outcome),
       note = COALESCE($4, note),
       pages = COALESCE($5, pages),
       max_tier = GREATEST(max_tier, COALESCE($6, 0)),
       started_at = CASE WHEN $7 AND started_at IS NULL THEN now() ELSE started_at END,
       finished_at = CASE WHEN $8 THEN now() ELSE finished_at END
     WHERE id = $1`,
    [
      id,
      status,
      fields.outcome ?? null,
      fields.note ?? null,
      fields.pages ?? null,
      fields.max_tier ?? null,
      starting,
      terminal,
    ],
  );
}

export async function insertPage(p: {
  domain_id: string;
  url: string;
  final_url: string | null;
  kind: string | null;
  tier: number;
  status_code: number | null;
  content_hash: string | null;
  text_length: number | null;
  blocked: boolean;
  error: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO pages (domain_id, url, final_url, kind, tier, status_code, content_hash, text_length, blocked, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      p.domain_id,
      p.url,
      p.final_url,
      p.kind,
      p.tier,
      p.status_code,
      p.content_hash,
      p.text_length,
      p.blocked,
      p.error,
    ],
  );
}

/** Merge fields are owned by the dedupe sweep, never by the code inserting a lead. */
export type LeadInsert = Omit<LeadRow, "id" | "created_at" | "merged_into" | "merged_domains">;

export async function upsertLead(lead: LeadInsert): Promise<void> {
  await query(
    `INSERT INTO leads (
       run_id, domain_id, domain, company_name, website, description, industry, country, city, address,
       employee_count, employee_range, founded_year, funding_stage, funding_amount, funding_year,
       emails, phones, socials, people, technologies, contact_form_url, provenance,
       score, score_breakdown, match_reason
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       $11,$12,$13,$14,$15,$16,
       $17,$18,$19,$20,$21,$22,$23,
       $24,$25,$26
     )
     ON CONFLICT (run_id, domain) DO UPDATE SET
       company_name = EXCLUDED.company_name,
       description = EXCLUDED.description,
       emails = EXCLUDED.emails,
       phones = EXCLUDED.phones,
       socials = EXCLUDED.socials,
       people = EXCLUDED.people,
       provenance = EXCLUDED.provenance,
       score = EXCLUDED.score,
       score_breakdown = EXCLUDED.score_breakdown,
       match_reason = EXCLUDED.match_reason`,
    [
      lead.run_id,
      lead.domain_id,
      lead.domain,
      lead.company_name,
      lead.website,
      lead.description,
      lead.industry,
      lead.country,
      lead.city,
      lead.address,
      lead.employee_count,
      lead.employee_range,
      lead.founded_year,
      lead.funding_stage,
      lead.funding_amount,
      lead.funding_year,
      JSON.stringify(lead.emails),
      JSON.stringify(lead.phones),
      JSON.stringify(lead.socials),
      JSON.stringify(lead.people),
      JSON.stringify(lead.technologies),
      lead.contact_form_url,
      JSON.stringify(lead.provenance),
      lead.score,
      JSON.stringify(lead.score_breakdown),
      lead.match_reason,
    ],
  );
}

export function listLeads(runId: string): Promise<LeadRow[]> {
  return query<LeadRow>(
    `SELECT * FROM leads WHERE run_id = $1 ORDER BY score DESC, company_name ASC`,
    [runId],
  );
}

/** Leads that actually ship: survivors only, absorbed duplicates excluded. */
export function listShippableLeads(runId: string): Promise<LeadRow[]> {
  return query<LeadRow>(
    `SELECT * FROM leads WHERE run_id = $1 AND merged_into IS NULL
     ORDER BY score DESC, company_name ASC`,
    [runId],
  );
}

/**
 * Apply one dedupe merge: overwrite the survivor with its absorbed values, then
 * point the losers at it.
 *
 * Both halves run in one statement pair against the same connection so a crash
 * cannot leave a lead marked merged into a survivor that never took its data.
 */
export async function applyLeadMerge(
  survivor: LeadRow,
  absorbedIds: string[],
  absorbedDomains: string[],
): Promise<void> {
  await query(
    `UPDATE leads SET
       company_name = $2, website = $3, description = $4, industry = $5, country = $6, city = $7,
       address = $8, employee_count = $9, employee_range = $10, founded_year = $11,
       funding_stage = $12, funding_amount = $13, funding_year = $14,
       emails = $15, phones = $16, socials = $17, people = $18, technologies = $19,
       contact_form_url = $20, provenance = $21, merged_domains = $22
     WHERE id = $1`,
    [
      survivor.id,
      survivor.company_name,
      survivor.website,
      survivor.description,
      survivor.industry,
      survivor.country,
      survivor.city,
      survivor.address,
      survivor.employee_count,
      survivor.employee_range,
      survivor.founded_year,
      survivor.funding_stage,
      survivor.funding_amount,
      survivor.funding_year,
      JSON.stringify(survivor.emails),
      JSON.stringify(survivor.phones),
      JSON.stringify(survivor.socials),
      JSON.stringify(survivor.people),
      JSON.stringify(survivor.technologies),
      survivor.contact_form_url,
      JSON.stringify(survivor.provenance),
      JSON.stringify(absorbedDomains),
    ],
  );

  if (absorbedIds.length > 0) {
    await query(`UPDATE leads SET merged_into = $1 WHERE id = ANY($2::uuid[])`, [
      survivor.id,
      absorbedIds,
    ]);
  }
}

export async function logEvent(
  runId: string,
  stage: string,
  message: string,
  opts: { level?: "info" | "warn" | "error"; data?: unknown } = {},
): Promise<void> {
  await query(
    `INSERT INTO run_events (run_id, level, stage, message, data) VALUES ($1,$2,$3,$4,$5)`,
    [runId, opts.level ?? "info", stage, message, opts.data ? JSON.stringify(opts.data) : null],
  );
}

export function listEvents(runId: string, limit = 200): Promise<RunEventRow[]> {
  return query<RunEventRow>(
    `SELECT * FROM run_events WHERE run_id = $1 ORDER BY id DESC LIMIT $2`,
    [runId, limit],
  );
}

export type { Requirements };
