import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createStopFlightLedger } from "./stopFlightLedger";

/**
 * The Today Stop flight's synchronous ledger. Each case replays the order the Dashboard's callbacks can run
 * in: begin (measured) → publications → acceptance (isLive) → queued ghost completion (finish).
 */
describe("Stop flight ledger", () => {
  it("lands once when the Stop is applied and accepted", () => {
    const ledger = createStopFlightLedger();
    ledger.begin(1, "entry-a");
    expect(ledger.published("entry-a", "entry-a")).toBeNull(); // a tick before the Stop is applied
    expect(ledger.published("entry-a", null)).toBeNull(); // optimistic Stop
    expect(ledger.isLive(1)).toBe(true); // acceptance flies
    expect(ledger.finish(1)).toBe(true);
    expect(ledger.finish(1)).toBe(false);
  });

  it("a refresh restoring the running block cancels the flight before acceptance and completion (Codex r4 on #415)", () => {
    const ledger = createStopFlightLedger();
    ledger.begin(1, "entry-a");
    ledger.published("entry-a", null);
    // Rejection persisted; a concurrent refresh publishes the running entry again.
    expect(ledger.published(null, "entry-a")).toBe(1);
    // A late acceptance does nothing, and a completion already queued cannot pop the running row.
    expect(ledger.isLive(1)).toBe(false);
    expect(ledger.finish(1)).toBe(false);
  });

  it("a restoration under the canonical ID still cancels a flight begun on the optimistic ID", () => {
    const ids = new Map([["optimistic-1", "entry-a"]]);
    const ledger = createStopFlightLedger((id) => ids.get(id) ?? id);
    ledger.begin(4, "optimistic-1");
    ledger.published("optimistic-1", null);
    expect(ledger.published(null, "entry-a")).toBe(4);
    expect(ledger.finish(4)).toBe(false);
  });

  it("a newer block or another publication keeps the flight", () => {
    const ledger = createStopFlightLedger();
    ledger.begin(2, "entry-a");
    ledger.published("entry-a", null);
    expect(ledger.published(null, null)).toBeNull();
    expect(ledger.published(null, "entry-b")).toBeNull(); // a Start right after Stop
    expect(ledger.finish(2)).toBe(true);
  });

  it("rollback, a newer flight and logout each end only what they own", () => {
    const ledger = createStopFlightLedger();
    ledger.begin(1, "entry-a");
    expect(ledger.cancelFor("entry-b")).toBeNull();
    expect(ledger.cancelFor("entry-a")).toBe(1);
    expect(ledger.cancelFor("entry-a")).toBeNull();

    ledger.begin(2, "entry-a");
    ledger.begin(3, "entry-c");
    expect(ledger.finish(2)).toBe(false);
    ledger.clear(2);
    expect(ledger.isLive(3)).toBe(true);
    ledger.clear();
    expect(ledger.finish(3)).toBe(false);
  });
});

describe("Dashboard data publication", () => {
  it("publishes dashboard data only through publishDashboardData, apart from the sign-out clear", () => {
    const source = readFileSync(join(__dirname, "..", "DayframeDashboard.tsx"), "utf8");
    const writes = [...source.matchAll(/latestData\.current = ([^;]+);/g)].map((match) => match[1]);
    expect(writes.sort()).toEqual(["next", "null"]);
    const setDataCalls = [...source.matchAll(/\bsetData\(([^)]*)\)/g)].map((match) => match[1]);
    expect(setDataCalls.sort()).toEqual(["next", "null"]);
  });
});
