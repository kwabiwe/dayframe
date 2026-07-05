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

export function isUndefinedColumnError(error: unknown, columnName?: string) {
  const candidate = error as { code?: string; message?: string } | null;
  if (candidate?.code !== "42703") return false;
  return columnName ? candidate.message?.includes(columnName) === true : true;
}

export class MissingRequiredColumnError extends Error {
  tableName: string;
  columnName: string;
  migrationHint: string;

  constructor(tableName: string, columnName: string, migrationHint: string, cause?: unknown) {
    super(`Database schema is missing ${tableName}.${columnName}. Run ${migrationHint} before using this feature.`);
    this.name = "MissingRequiredColumnError";
    this.tableName = tableName;
    this.columnName = columnName;
    this.migrationHint = migrationHint;
    if (cause) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export function missingRequiredColumnError(
  tableName: string,
  columnName: string,
  migrationHint: string,
  cause?: unknown
) {
  return new MissingRequiredColumnError(tableName, columnName, migrationHint, cause);
}

export function isMissingRequiredColumnError(error: unknown): error is MissingRequiredColumnError {
  return error instanceof MissingRequiredColumnError;
}

type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

export async function hasTableColumn(
  client: Queryable,
  tableName: string,
  columnName: string,
  schemaName = "public"
) {
  const result = await client.query<{ exists: boolean }>(
    `select exists (
       select 1
       from information_schema.columns
       where table_schema = $1
         and table_name = $2
         and column_name = $3
     ) as "exists"`,
    [schemaName, tableName, columnName]
  );
  return Boolean(result.rows[0]?.exists);
}
