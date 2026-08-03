-- AI lead-generation employee — schema
-- Applied idempotently by src/db/migrate.ts

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- A run is one natural-language query taken from plan -> discovery -> scrape -> leads.
CREATE TABLE IF NOT EXISTS runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query           TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'planning',
  -- planning | awaiting_approval | discovering | scraping | completed | failed | cancelled
  plan            JSONB,
  requirements    JSONB,
  error           TEXT,
  domains_total   INTEGER     NOT NULL DEFAULT 0,
  domains_done    INTEGER     NOT NULL DEFAULT 0,
  domains_failed  INTEGER     NOT NULL DEFAULT 0,
  pages_fetched   INTEGER     NOT NULL DEFAULT 0,
  tier1_pages     INTEGER     NOT NULL DEFAULT 0,
  tier2_pages     INTEGER     NOT NULL DEFAULT 0,
  llm_input_tokens  BIGINT    NOT NULL DEFAULT 0,
  llm_output_tokens BIGINT    NOT NULL DEFAULT 0,
  llm_cached_tokens BIGINT    NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at     TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS runs_created_at_idx ON runs (created_at DESC);
CREATE INDEX IF NOT EXISTS runs_status_idx ON runs (status);

-- One row per registrable domain discovered in a run.
CREATE TABLE IF NOT EXISTS domains (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  domain       TEXT NOT NULL,
  seed_url     TEXT NOT NULL,
  source       TEXT NOT NULL,          -- tavily | exa | manual
  status       TEXT NOT NULL DEFAULT 'queued',
  -- queued | fetching | extracting | done | failed | blocked | skipped
  outcome      TEXT,                   -- ok | blocked | robots_disallowed | no_contact | form_only | unreachable
  note         TEXT,
  pages        INTEGER NOT NULL DEFAULT 0,
  max_tier     SMALLINT NOT NULL DEFAULT 0,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, domain)
);

CREATE INDEX IF NOT EXISTS domains_run_status_idx ON domains (run_id, status);

-- One row per fetched page. raw HTML lives content-addressed on disk.
CREATE TABLE IF NOT EXISTS pages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id     UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  final_url     TEXT,
  kind          TEXT,                  -- home | about | team | contact | imprint | careers | other
  tier          SMALLINT NOT NULL,
  status_code   INTEGER,
  content_hash  TEXT,
  text_length   INTEGER,
  blocked       BOOLEAN NOT NULL DEFAULT false,
  error         TEXT,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pages_domain_idx ON pages (domain_id);

-- The product. One lead per company per run.
CREATE TABLE IF NOT EXISTS leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  domain_id         UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  domain            TEXT NOT NULL,
  company_name      TEXT,
  website           TEXT,
  description       TEXT,
  industry          TEXT,
  country           TEXT,
  city              TEXT,
  address           TEXT,
  employee_count    INTEGER,
  employee_range    TEXT,
  founded_year      INTEGER,
  funding_stage     TEXT,
  funding_amount    TEXT,
  funding_year      INTEGER,
  emails            JSONB NOT NULL DEFAULT '[]'::jsonb,
  phones            JSONB NOT NULL DEFAULT '[]'::jsonb,
  socials           JSONB NOT NULL DEFAULT '{}'::jsonb,
  people            JSONB NOT NULL DEFAULT '[]'::jsonb,
  technologies      JSONB NOT NULL DEFAULT '[]'::jsonb,
  contact_form_url  TEXT,
  -- provenance: field -> { source_url, method, confidence }
  provenance        JSONB NOT NULL DEFAULT '{}'::jsonb,
  score             NUMERIC(5,2) NOT NULL DEFAULT 0,
  score_breakdown   JSONB NOT NULL DEFAULT '{}'::jsonb,
  match_reason      TEXT,
  -- Set when cross-domain dedupe folds this lead into another. The row is kept
  -- rather than deleted: the scrape really happened, and a merge that turns out
  -- wrong has to be inspectable. Exports filter on it.
  merged_into       UUID REFERENCES leads(id) ON DELETE SET NULL,
  -- Domains folded into this lead, when it is a survivor.
  merged_domains    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, domain)
);

-- Added after the first schema shipped; harmless on a fresh database.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS merged_domains JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS leads_run_score_idx ON leads (run_id, score DESC);
CREATE INDEX IF NOT EXISTS leads_domain_idx ON leads (domain);

-- Append-only run log surfaced in the dashboard timeline.
CREATE TABLE IF NOT EXISTS run_events (
  id         BIGSERIAL PRIMARY KEY,
  run_id     UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  level      TEXT NOT NULL DEFAULT 'info',   -- info | warn | error
  stage      TEXT NOT NULL,
  message    TEXT NOT NULL,
  data       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS run_events_run_idx ON run_events (run_id, id DESC);
