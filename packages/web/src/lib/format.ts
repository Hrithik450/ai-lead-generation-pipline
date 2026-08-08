import type { DomainStatus, RunStatus } from "@lead/core";

/**
 * Status presentation.
 *
 * Every status carries a word alongside its colour. Colour alone fails WCAG 2.2
 * AA and fails anyone reading this on a projector, so the badge component always
 * renders the label — the tone class only reinforces it.
 */

type Tone = "ok" | "warn" | "danger" | "info" | "idle";

const RUN_TONES: Record<RunStatus, Tone> = {
  planning: "info",
  awaiting_approval: "warn",
  discovering: "info",
  scraping: "info",
  completed: "ok",
  failed: "danger",
  cancelled: "idle",
};

const RUN_LABELS: Record<RunStatus, string> = {
  planning: "Planning",
  awaiting_approval: "Awaiting approval",
  discovering: "Discovering",
  scraping: "Scraping",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const DOMAIN_TONES: Record<DomainStatus, Tone> = {
  queued: "idle",
  fetching: "info",
  extracting: "info",
  done: "ok",
  failed: "danger",
  blocked: "danger",
  skipped: "idle",
};

export function runTone(status: RunStatus): Tone {
  return RUN_TONES[status] ?? "idle";
}

export function runLabel(status: RunStatus): string {
  return RUN_LABELS[status] ?? status;
}

export function domainTone(status: DomainStatus): Tone {
  return DOMAIN_TONES[status] ?? "idle";
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}
