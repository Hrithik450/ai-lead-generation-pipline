import pg from "pg";

const { Pool } = pg;

// Numeric columns come back as strings by default; leads.score is small enough to be safe.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// int8 (BIGSERIAL / BIGINT counters) — our values stay well inside Number.MAX_SAFE_INTEGER.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

let pool: pg.Pool | undefined;

export function db(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await db().query<T>(text, params as never[]);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
