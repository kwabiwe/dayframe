import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BOOTSTRAP_READ_CONCURRENCY, runBootstrapReads } from "./queries";

// Stability audit 22 Oct 2026 (SERVER-3): bootstrap's 21 reads fired at once took the whole 10-connection
// pool, so a second bootstrap or a timer write behind them timed out (production, 21 Oct).

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe("bootstrap reads", () => {
  it("runs at most the limit at once and keeps every result in its place", async () => {
    let running = 0;
    let peak = 0;
    const reads = Array.from({ length: 21 }, (_, index) => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, (index * 7) % 5));
      running -= 1;
      return index;
    });

    const results = await runBootstrapReads(reads);
    expect(results).toEqual(Array.from({ length: 21 }, (_, index) => index));
    expect(peak).toBe(BOOTSTRAP_READ_CONCURRENCY);
  });

  it("fails like Promise.all and starts no further reads after a failure", async () => {
    const gates = Array.from({ length: 8 }, deferred);
    const started: number[] = [];
    const run = runBootstrapReads(gates.map((gate, index) => () => {
      started.push(index);
      return gate.promise;
    }));
    const settled = expect(run).rejects.toThrow("pool");
    gates[0]!.reject(new Error("pool"));
    await settled;
    gates.slice(1).forEach((gate) => gate.resolve());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it("leaves room in the pool for a second bootstrap and for timer writes", () => {
    const db = readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");
    const max = Number(db.match(/max: (\d+)/)?.[1]);
    expect(BOOTSTRAP_READ_CONCURRENCY * 2).toBeLessThan(max);
    const queries = readFileSync(fileURLToPath(new URL("./queries.ts", import.meta.url)), "utf8");
    const bootstrap = queries.slice(queries.indexOf("export async function getBootstrapData("), queries.indexOf("const locationGroups = await getLocationGroups"));
    expect(bootstrap).toContain("await runBootstrapReads([");
    expect(bootstrap).not.toContain("Promise.all(");
  });
});
