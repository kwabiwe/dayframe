import { expect, it } from "vitest";
import { dueSyncLanes, nextSyncWorkDueAt, type SyncDueTimes } from "./syncDueTimes";
it("does not replay other lanes for a Review mutation waiting an hour", () => {
  const now = Date.now();
  const lanes: SyncDueTimes = {
    timer: { pending: 0, nextDueAt: null },
    activity: { pending: 0, nextDueAt: null },
    review: { pending: 1, nextDueAt: new Date(now + 3_600_000).toISOString() },
    location: { pending: 0, nextDueAt: null }
  };
  expect([...dueSyncLanes(lanes, now)]).toEqual([]);
  expect(nextSyncWorkDueAt(lanes)).toBe(now + 3_600_000);
  expect([...dueSyncLanes(lanes, now + 3_600_000)]).toEqual(["review"]);
  lanes.location = { pending: 1, nextDueAt: null };
  expect([...dueSyncLanes(lanes, now)]).toEqual(["location"]);
});
