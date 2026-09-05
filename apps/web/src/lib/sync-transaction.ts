import type pg from "pg";
import { pool } from "./db";

export const SYNC_OPERATION_MS = 8_000;
export const SYNC_CLEANUP_MS = 1_000;
export const SYNC_STATEMENT_MS = 3_000;
export const SYNC_LOCK_MS = 1_500;
export const SYNC_IDLE_MS = 5_000;

export type SyncPhase = "acquire" | "begin" | "configure" | "receipt_read" | "mutation_lock" |
  "owner_lock" | "canonical_read" | "review_lock" | "effect" | "receipt_write" | "commit" | "rollback";

export class SyncOperationError extends Error {
  constructor(
    readonly reason: "operation_deadline" | "cancelled" | "connection_unavailable" | "query_failed",
    readonly phase: SyncPhase,
    readonly operation: string,
    readonly sqlState?: string,
    options?: ErrorOptions
  ) {
    super(`Sync operation ${reason} during ${phase}.`, options);
    this.name = "SyncOperationError";
  }
}

export type SyncTransactionOptions = {
  signal?: AbortSignal;
  deadlineAt?: number;
  cleanupReserveMs?: number;
  readOnly?: boolean;
  databasePool?: Pick<pg.Pool, "connect">;
};

export type SyncTransaction = {
  client: pg.PoolClient;
  phase: (value: SyncPhase) => void;
  remainingMs: () => number;
};
const phases = new WeakMap<pg.PoolClient, (phase: SyncPhase) => void>();
export function setSyncPhase(client: pg.PoolClient, phase: SyncPhase) {
  phases.get(client)?.(phase);
}

/** Narrow owner for Review/Health/Location transactions. No SQL parameters are logged.
 * pg 8.22 PoolClient.release(true) removes the client and calls Client.end(), which
 * destroys an active-query socket. The server idle/transaction guards also apply
 * when this process cannot execute a finally block. See real DB validation.
 */
export async function withSyncTransaction<T>(
  operation: string,
  work: (transaction: SyncTransaction) => Promise<T>,
  options: SyncTransactionOptions = {}
): Promise<T> {
  const deadline = options.deadlineAt ?? Date.now() + SYNC_OPERATION_MS;
  const reserve = Math.min(options.cleanupReserveMs ?? SYNC_CLEANUP_MS, Math.max(0, deadline - Date.now() - 1));
  const workDeadline = deadline - reserve;
  let phase: SyncPhase = "acquire";
  let raw: pg.PoolClient | undefined;
  let released = false;
  let expired = false;
  let began = false;
  let committed = false;
  let queryInFlight = false;
  let guard: ReturnType<typeof setTimeout> | undefined;
  let rejectGuard: (error: Error) => void = () => {};
  const remainingMs = () => Math.max(0, workDeadline - Date.now());
  const errorFor = (reason: SyncOperationError["reason"]) => new SyncOperationError(reason, phase, operation);
  const release = (destroy: boolean) => {
    if (!raw || released) return;
    released = true;
    raw.release(destroy);
  };
  const expire = (reason: "operation_deadline" | "cancelled") => {
    if (expired) return;
    expired = true;
    // This is actual connection destruction, not just abandonment of a Promise.
    release(true);
    rejectGuard(errorFor(reason));
  };
  const check = () => {
    if (options.signal?.aborted) throw errorFor("cancelled");
    if (expired || remainingMs() <= 0 || released) throw errorFor("operation_deadline");
  };
  const onAbort = () => expire("cancelled");
  const guardPromise = new Promise<never>((_, reject) => { rejectGuard = reject; });
  const onClientError = (error: Error & { code?: string }) => {
    if (expired) return;
    expired = true;
    release(true);
    rejectGuard(new SyncOperationError("query_failed", phase, operation, error.code));
  };
  try {
    check();
    guard = setTimeout(() => expire("operation_deadline"), remainingMs());
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const acquire = (options.databasePool ?? pool).connect().then((client) => {
      if (expired) { client.release(true); throw errorFor("operation_deadline"); }
      raw = client;
      // An idle-in-transaction termination emits error outside a query.
      raw.on?.("error", onClientError);
      return client;
    });
    raw = await Promise.race([acquire, guardPromise]);
    check();
    const queryRaw = async (sql: string, params?: unknown[]) => {
      queryInFlight = true;
      try { return await (params ? raw!.query(sql, params) : raw!.query(sql)); }
      finally { queryInFlight = false; }
    };
    const run = async () => {
      phase = "begin";
      began = true;
      // A single protocol message installs the idle guard immediately after BEGIN.
      await queryRaw(`begin${options.readOnly ? " read only" : ""}; set local idle_in_transaction_session_timeout = '${SYNC_IDLE_MS}ms'; set local statement_timeout = '${Math.max(1, Math.min(SYNC_STATEMENT_MS, remainingMs()))}ms'; set local lock_timeout = '${Math.max(1, Math.min(SYNC_LOCK_MS, remainingMs()))}ms'`);
      check();
      phase = "configure";
      await queryRaw("select set_config('application_name', $1, true)", [`dayframe.sync.${operation}`]);
      const support = await queryRaw("select current_setting('transaction_timeout', true) as transaction_timeout");
      if (support.rows[0]?.transaction_timeout != null) {
        await queryRaw("select set_config('transaction_timeout', $1, true)", [`${Math.max(1, remainingMs())}ms`]);
      }
      // Every nested service query stays on the checked-out client and consumes
      // the SAME operation budget. Savepoint recovery must run in an aborted tx.
      const client = new Proxy(raw!, {
        get(target, property) {
          if (property === "release") return () => { throw new Error("Sync transaction owns release"); };
          if (property === "query") return async (sql: string, params?: unknown[]) => {
            check();
            if (!/^\s*(rollback to|release savepoint)/i.test(sql)) {
              await queryRaw("select set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true)", [
                `${Math.max(1, Math.min(SYNC_STATEMENT_MS, remainingMs()))}ms`,
                `${Math.max(1, Math.min(SYNC_LOCK_MS, remainingMs()))}ms`
              ]);
              check();
            }
            return queryRaw(sql, params);
          };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
      phases.set(client, value => { phase = value; });
      phase = "effect";
      const result = await work({ client, phase: (value) => { phase = value; }, remainingMs });
      check();
      phase = "commit";
      await queryRaw("commit");
      committed = true;
      return result;
    };
    return await Promise.race([run(), guardPromise]);
  } catch (error) {
    const failedPhase = phase;
    if (guard) clearTimeout(guard);
    if (raw && !released && began && !committed) {
      if (queryInFlight) release(true);
      else {
        phase = "rollback";
        let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            raw.query("rollback"),
            new Promise<never>((_, reject) => {
              cleanupTimer = setTimeout(() => { release(true); reject(errorFor("operation_deadline")); }, Math.max(1, deadline - Date.now()));
            })
          ]);
        } catch { release(true); }
        finally { if (cleanupTimer) clearTimeout(cleanupTimer); }
      }
    }
    if (error instanceof SyncOperationError) throw error;
    if (failedPhase === "acquire") {
      const code = (error as { code?: string })?.code;
      throw new SyncOperationError("connection_unavailable", failedPhase, operation,
        /^[0-9A-Z]{5}$/.test(code ?? "") ? code : undefined, { cause: error });
    }
    // Preserve domain errors and attach only safe execution metadata.
    if (error && typeof error === "object") {
      Object.assign(error, { syncPhase: failedPhase, syncOperation: operation });
    }
    throw error;
  } finally {
    if (guard) clearTimeout(guard);
    options.signal?.removeEventListener("abort", onAbort);
    if (raw && !released) {
      raw.removeListener?.("error", onClientError);
      release(!committed);
    }
  }
}

/** Redacted failure classification shared by the compatible sync routes. */
export function syncFailureMetadata(error: unknown) {
  const value = error as { code?: string; sqlState?: string; syncPhase?: string; phase?: string; message?: string } | null;
  const sqlState = value?.sqlState ?? (/^[0-9A-Z]{5}$/.test(value?.code ?? "") ? value!.code : undefined);
  const timedOut = error instanceof SyncOperationError && error.reason === "operation_deadline" ||
    value?.message === "canceling statement due to statement timeout" || ["25P03", "25P04", "57P05"].includes(sqlState ?? "");
  const cancelled = sqlState === "57014" || error instanceof SyncOperationError && error.reason === "cancelled";
  return {
    reason: timedOut ? "operation_timeout" : cancelled ? "query_cancelled" : "service_unavailable",
    phase: value?.syncPhase ?? value?.phase ?? "unknown",
    ...(sqlState ? { sqlState } : {})
  };
}
