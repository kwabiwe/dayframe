import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Stability audit 22 Oct 2026 (iphone-timer-sync-3): `rejectOptimisticTimerStart` had no caller from
// 22 Aug, while contract tests that matched its source text kept passing. Its call site is guarded here;
// the behaviour (Stops removed, Edits settled, listeners told) is covered in api.test.ts and
// timeEntryOutbox.test.ts.
const dashboard = readFileSync(
  fileURLToPath(new URL("../components/DayframeDashboard.tsx", import.meta.url)),
  "utf8"
);

describe("refused queued Starts", () => {
  it("roll the shown block back through the Dashboard's rejection path", () => {
    expect(dashboard).toContain("rejectOptimisticTimerStartRef.current = rejectOptimisticTimerStart;");
    const subscription = dashboard.slice(dashboard.indexOf("useEffect(() => subscribeRefusedTimerStarts("));
    const body = subscription.slice(0, subscription.indexOf("}), []);"));
    expect(body).toContain("rejectOptimisticTimerStartRef.current(localId, null, new Error(message));");
    expect(body).toContain("queueDashboardRefreshAfterConflict();");
  });

  it("never restores the Start's own (possibly hours-old) snapshot", () => {
    const subscription = dashboard.slice(dashboard.indexOf("useEffect(() => subscribeRefusedTimerStarts("));
    expect(subscription.slice(0, subscription.indexOf("}), []);"))).not.toMatch(/previousData|snapshot/);
  });
});
