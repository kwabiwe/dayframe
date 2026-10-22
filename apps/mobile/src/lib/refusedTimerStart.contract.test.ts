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
  const subscription = dashboard.slice(dashboard.indexOf("useEffect(() => subscribeRefusedTimerStarts("));
  const body = subscription.slice(0, subscription.indexOf("}), []);"));

  it("roll the block back through the Dashboard's rejection path, decided by refusedTimerStartPresentation", () => {
    expect(dashboard).toContain("rejectOptimisticTimerStartRef.current = rejectOptimisticTimerStart;");
    expect(body).toContain("const decision = refusedTimerStartPresentation({");
    expect(body).toContain("rejectOptimisticTimerStartRef.current(localId, null, new Error(message), decision.alert);");
    expect(body).toContain("queueDashboardRefreshAfterConflict();");
    expect(body).toContain("deletionPending: Boolean(deletionCoordinator.current?.current()?.entryIds.includes(localId))");
  });

  it("dismiss a Calendar editor open on the refused block through its own exit", () => {
    expect(body).toContain("setCalendarEditDismissRequestId(calendarEditPresentationRef.current.id);");
    expect(dashboard).toContain("dismissRequestId={calendarEditDismissRequestId}");
  });

  it("never restore the Start's own (possibly hours-old) snapshot", () => {
    expect(body).not.toMatch(/previousData|snapshot/);
  });
});
