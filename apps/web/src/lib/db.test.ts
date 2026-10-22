import { EventEmitter } from "node:events";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeDatabaseErrors, pool } from "./db";

// Stability audit 22 Oct 2026 (SERVER-2): a connection ended by the pooler or Postgres emits `error`
// outside any awaited promise; without a listener Node throws and the function instance crashes.

describe("database connection errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the process alive when an idle pooled connection is ended", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fresh = new pg.Pool({ connectionString: "postgres://dayframe@127.0.0.1:1/none" });
    expect(() => fresh.emit("error", new Error("terminating connection due to administrator command"))).toThrow();

    observeDatabaseErrors(fresh);
    expect(() => fresh.emit("error", Object.assign(new Error("terminating connection"), { code: "57P01" }))).not.toThrow();
    expect(logged).toHaveBeenCalledWith("[db] idle connection error", "57P01", "terminating connection");
  });

  it("keeps the process alive when a checked-out connection is ended, without logging queries", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fresh = new pg.Pool({ connectionString: "postgres://dayframe@127.0.0.1:1/none" });
    observeDatabaseErrors(fresh);
    const client = new EventEmitter();
    fresh.emit("connect", client as unknown as pg.PoolClient);

    expect(() => client.emit("error", new Error("Connection terminated unexpectedly"))).not.toThrow();
    expect(logged).toHaveBeenCalledWith("[db] client connection error", "", "Connection terminated unexpectedly");
  });

  it("observes the app's pool once, however often the module is evaluated", () => {
    expect(pool.listenerCount("error")).toBe(1);
    expect(pool.listenerCount("connect")).toBe(1);
    observeDatabaseErrors(pool);
    expect(pool.listenerCount("error")).toBe(1);
  });
});
