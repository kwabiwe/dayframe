export type SyncLaneName = "timer" | "activity" | "review" | "location";
export type SyncDueTimes = Record<SyncLaneName, { pending: number; nextDueAt: string | null }>;
export function dueSyncLanes(lanes: SyncDueTimes | undefined, now = Date.now()) {
  return new Set<SyncLaneName>(
    (["timer", "activity", "review", "location"] as const).filter((name) => {
      if (!lanes) return true;
      const lane = lanes[name];
      return (
        lane.pending > 0 &&
        (!lane.nextDueAt ||
          !Number.isFinite(Date.parse(lane.nextDueAt)) ||
          Date.parse(lane.nextDueAt) <= now)
      );
    })
  );
}
export function nextSyncWorkDueAt(lanes: SyncDueTimes | undefined): number | null {
  if (!lanes) return null;
  const due = Object.values(lanes)
    .filter((lane) => lane.pending > 0)
    .map((lane) => (lane.nextDueAt ? Date.parse(lane.nextDueAt) : 0));
  return due.length ? Math.min(...due.map((value) => (Number.isFinite(value) ? value : 0))) : null;
}
