import pg from "pg";
import { DEFAULT_DATABASE_URL } from "./constants";

const { Pool } = pg;

const globalForPg = globalThis as unknown as {
  dayframePool?: pg.Pool;
};

export const pool =
  globalForPg.dayframePool ??
  new Pool({
    connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    max: 10
  });

if (process.env.NODE_ENV !== "production") {
  globalForPg.dayframePool = pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
) {
  return pool.query<T>(text, params);
}
