import { MINIMUM_MEANINGFUL_OVERLAP_MS } from "@dayframe/shared";
import type { MobileBootstrap, MobileReviewItem, MobileTimeEntry } from "./api";

export function reviewPeerEntries(data: MobileBootstrap | null): MobileTimeEntry[] {
  if (!data) return [];
  return Array.from(new Map([
    ...(data.historyEntries ?? []), ...(data.weekEntries ?? []),
    ...(data.dayEntries ?? []), ...(data.entries ?? [])
  ].map((entry) => [entry.id, entry])).values());
}

/** Cards only need a count. Do not recompute the peers' full overlap graph per card. */
export function prepareReviewOverlapCounts(
  items: MobileReviewItem[], peers: MobileTimeEntry[], now: number
): Map<string, number> {
  const intervals = peers.map((entry) => ({
    start: Date.parse(entry.startedAt), end: entry.stoppedAt === null ? now : Date.parse(entry.stoppedAt)
  })).filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start);
  return new Map(items.map((item) => {
    const start = Date.parse(item.suggestedStartedAt ?? "");
    const end = Date.parse(item.suggestedStoppedAt ?? "");
    let count = 0;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      for (const peer of intervals) {
        if (Math.min(end, peer.end) - Math.max(start, peer.start) >= MINIMUM_MEANINGFUL_OVERLAP_MS) count += 1;
      }
    }
    return [item.id, count];
  }));
}
