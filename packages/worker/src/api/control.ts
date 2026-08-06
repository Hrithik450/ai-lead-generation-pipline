import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getRun } from "@lead/core";
import { config } from "../config.js";
import { approveRun, beginRun } from "../pipeline/orchestrator.js";
import { cancelRun } from "../pipeline/run.js";

/**
 * The worker's control API.
 *
 * The dashboard reads Postgres directly — runs, domains, leads and events are all
 * just rows, and an API in front of a SELECT buys nothing. Writes are different:
 * starting a run needs the planner, approving it needs the search providers, and
 * cancelling needs the BullMQ queue. Those live here, behind Playwright and
 * Chromium, which is not something a Next.js server bundle should be importing.
 *
 * So this exposes exactly the three verbs that cross that boundary, and nothing
 * else. It binds to the compose network and is not a public API — there is no
 * auth here, and the port must not be published outside it.
 */

const ROUTE = /^\/runs\/([0-9a-f-]{36})\/(approve|cancel)$/;

export function startControlApi(): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  server.listen(config.controlPort, () => {
    console.log(`[worker] control api on :${config.controlPort}`);
  });
  return server;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "");

  if (req.method === "GET" && path === "/health") {
    return send(res, 200, { ok: true });
  }

  if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });

  if (path === "/runs") {
    const body = await readJson(req);
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) return send(res, 400, { error: "query is required" });

    const { run, plan, error } = await beginRun(query);
    return send(res, error ? 422 : 201, { runId: run.id, plan, error });
  }

  const match = ROUTE.exec(path);
  if (match) {
    const runId = match[1] as string;
    if (!(await getRun(runId))) return send(res, 404, { error: "run not found" });

    const result = match[2] === "approve" ? await approveRun(runId) : await cancelRun(runId);
    // A rejected approval is the gate working, not a server fault — the caller
    // needs to tell "you already approved this" apart from "the worker broke".
    return send(res, "error" in result && result.error ? 409 : 200, result);
  }

  send(res, 404, { error: "not found" });
}

/** Capped: this endpoint takes a query string, and nothing it accepts is large. */
const MAX_BODY_BYTES = 16 * 1024;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
