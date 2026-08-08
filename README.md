# AI Lead Generation Pipeline

> Describe an ideal customer in plain English. Get scored, exportable company leads — with emails, phones, and firmographics — from a crawl that you approve before it spends.

An autonomous lead-generation employee: it **plans**, **discovers**, **fetches**, **extracts**, **scores**, and **exports** B2B leads through a human approval gate.

<p align="center">
  <img src="assets/system-architecture.png" alt="System architecture" width="920" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node 20+" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Next.js-App%20Router-000000?style=flat-square&logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/Postgres-16-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="Postgres" />
  <img src="https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/LLM-Google%20%7C%20OpenAI%20%7C%20Anthropic-8B5CF6?style=flat-square" alt="LLM providers" />
</p>

---

## Why this exists

Most lead tools either dump noisy lists or scrape blindly. This pipeline treats lead gen like an operator:

1. **Interpret** your ICP in natural language  
2. **Propose** a search plan you can approve or reject  
3. **Discover** company domains via web search providers  
4. **Fetch** sites politely, with SSRF guards and challenge escalation  
5. **Extract** firmographics + contacts (deterministic first, LLM when needed)  
6. **Score & dedupe** so exports are usable, not raw crawl residue  

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────────────────────┐
│  Next.js UI │────▶│ Control API  │────▶│ Redis queue + domain worker│
│  runs/leads │     │  (worker)    │     └─────────────┬──────────────┘
└──────┬──────┘     └──────────────┘                   │
       │                                               ▼
       │                                    ┌─────────────────────┐
       │                                    │ Tiered fetcher      │
       │                                    │ SSRF · politeness   │
       │                                    │ browser · managed   │
       │                                    └──────────┬──────────┘
       │                                               ▼
       │                                    ┌─────────────────────┐
       ▼                                    │ Extract → merge     │
┌─────────────┐                             │ Validate → score    │
│  Postgres   │◀────────────────────────────│ Dedupe → leads      │
└─────────────┘                             └─────────────────────┘
```

<p align="center">
  <img src="assets/data-flow.png" alt="Data flow" width="920" />
</p>

| Package | Role |
| --- | --- |
| `packages/core` | Shared types, Postgres schema, queries, URL helpers |
| `packages/worker` | Discovery, fetch, extract, queue, pipeline, control API |
| `packages/web` | Operator UI — start runs, approve plans, browse & export leads |

---

## Features

- **Natural-language ICP** — “Series A AI startups in Germany with 20–100 employees…”
- **Approval gate** — plan + search queries visible before crawl spend
- **Multi-provider discovery** — Tavily / Exa
- **Tiered fetching** — direct → managed scrapers → browser pool, with challenge detection
- **Hybrid extraction** — JSON-LD, microdata, regex/heuristics, then LLM fill
- **Privacy-aware defaults** — personal emails off unless explicitly enabled
- **Lead scoring & dedupe** — match confidence against your requirements
- **CSV / export** — per-run export from the web app
- **Docker Compose** — Postgres + Redis (+ optional full stack) in one command

---

## Quick start

### Prerequisites

- Node.js **20+**
- Docker (for Postgres & Redis)
- At least one LLM key and one search provider key (see `.env.example`)

### 1. Install & configure

```bash
git clone https://github.com/Hrithik450/ai-lead-generation-pipline.git
cd ai-lead-generation-pipline
npm install
cp .env.example .env
# fill in GOOGLE_API_KEY (or OpenAI/Anthropic) + TAVILY_API_KEY and/or EXA_API_KEY
```

### 2. Start infrastructure

```bash
npm run infra:up
npm run db:migrate
```

### 3. Run worker + UI

```bash
# terminal 1 — crawl / extract worker + control API
npm run worker

# terminal 2 — operator dashboard
npm run dev
```

Open the web app (default Next.js port) → describe a customer → approve the plan → watch leads arrive.

---

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` / `REDIS_URL` | Postgres & Redis (Compose defaults work locally) |
| `LLM_PROVIDER` | `google` (default), `openai`, or `anthropic` |
| `GOOGLE_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Model access |
| `TAVILY_API_KEY` / `EXA_API_KEY` | Company discovery |
| `HUNTER_API_KEY` | Optional email enrichment |
| `SCRAPINGBEE_API_KEY` / `FIRECRAWL_API_KEY` | Optional managed fetch tier |
| `ALLOW_PERSONAL_EMAILS` | `false` by default (GDPR-safer role inboxes) |

Full comments and defaults live in [`.env.example`](.env.example).

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run infra:up` | Start Postgres + Redis |
| `npm run db:migrate` | Apply schema |
| `npm run worker` | Domain worker + control API |
| `npm run dev` | Next.js operator UI |
| `npm test` | Worker unit tests |
| `npm run build` | Build core → worker → web |

---

## Pipeline stages

1. **Plan** — LLM turns the brief into requirements + search queries  
2. **Discover** — search providers return candidate domains  
3. **Fetch** — politeness-limited, SSRF-safe, escalated when blocked  
4. **Extract** — deterministic signals first; LLM completes the company record  
5. **Validate / score** — fit against requirements + confidence  
6. **Dedupe** — collapse duplicates before they hit the lead table  

---

## Safety & etiquette

- Outbound fetches are rate-limited and domain-scoped  
- Private/internal IP ranges are blocked (SSRF protection)  
- Personal email extraction is opt-in  
- You approve the plan before crawl budget is spent  

Use this only on sites and data you have a lawful right to process.

---

## Repo layout

```
├── packages/
│   ├── core/       # DB + shared domain types
│   ├── worker/     # Pipeline engine
│   └── web/        # Operator UI
├── assets/         # Architecture diagrams
├── docker-compose.yml
└── .env.example
```

---

## License

Private project — all rights reserved unless otherwise stated.
