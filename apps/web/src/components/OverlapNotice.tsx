import type { TimeIntervalInput } from "@dayframe/shared";
import { AlertTriangle } from "lucide-react";
import { formatDuration, formatTime } from "@/lib/format";
import {
  overlapNoticeForCandidate,
  type OverlapPeerEntry
} from "@/lib/overlap-notice";

export type { OverlapPeerEntry } from "@/lib/overlap-notice";

export function OverlapNotice({
  candidate,
  compact = false,
  entries,
  excludeEntryId
}: {
  candidate: Omit<TimeIntervalInput, "id">;
  compact?: boolean;
  entries: ReadonlyArray<OverlapPeerEntry>;
  excludeEntryId?: string | null;
}) {
  const overlap = overlapNoticeForCandidate({ candidate, entries, excludeEntryId });
  if (!overlap?.overlapCount) return null;
  if (compact) {
    const totalMinutes = Math.max(0, Math.round(overlap.uniqueOverlapSeconds / 60));
    const duration = `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
    return (
      <aside className="overlap-notice is-compact" role="status" aria-live="polite">
        <p>
          Overlaps {overlap.overlapCount === 1 ? "one block" : `${overlap.overlapCount} blocks`} by {duration}
        </p>
      </aside>
    );
  }
  const peerById = new Map(entries.map((entry) => [entry.id, entry]));
  const visiblePeers = overlap.overlappingEntryIds
    .map((id) => peerById.get(id))
    .filter((entry): entry is OverlapPeerEntry => Boolean(entry))
    .slice(0, 2);
  const duration = formatDuration(overlap.uniqueOverlapSeconds);

  return (
    <aside className="overlap-notice swiss-form-wide" role="status" aria-live="polite">
      <AlertTriangle aria-hidden="true" size={17} />
      <div>
        <span className="overlap-notice-badge">Overlap</span>
        <p>
          <strong>
            Overlaps {overlap.overlapCount} {overlap.overlapCount === 1 ? "block" : "blocks"}{" "}
            {overlap.overlapCount === 1 ? "by" : "across"} {duration}
          </strong>
        </p>
        {visiblePeers.length > 0 ? (
          <ul>
            {visiblePeers.map((entry) => (
              <li key={entry.id}>
                {entry.description?.trim() || entry.categoryName?.trim() || "Untitled block"}
                {" · "}{formatTime(entry.startedAt)}–{entry.stoppedAt ? formatTime(entry.stoppedAt) : "now"}
              </li>
            ))}
          </ul>
        ) : null}
        <p>
          This is allowed. Both activities count towards Total logged; concurrent clock time counts once in Time covered.
        </p>
      </div>
    </aside>
  );
}

/** An overlap that covers more than this share of the block gets the stronger cue. */
export const LARGE_OVERLAP_SHARE = 0.5;

/**
 * One quiet line under a Review card's time (Trello, owner-approved; matches iPhone): "Overlaps
 * Work by 10m". Overlapping is allowed, so there is no box or explanation; only an overlap
 * covering most of the block gets a warning cue.
 */
export function OverlapLine({
  candidate,
  entries,
  nowMs
}: {
  candidate: Omit<TimeIntervalInput, "id">;
  entries: ReadonlyArray<OverlapPeerEntry>;
  /** Where a running block (no stop) ends. */
  nowMs: number;
}) {
  // One clock for the analysis, the ranking and the threshold, so the same props say the same thing.
  const overlap = overlapNoticeForCandidate({ candidate, entries, now: new Date(nowMs) });
  if (!overlap?.overlapCount) return null;
  const start = new Date(candidate.startedAt).getTime();
  const stop = candidate.stoppedAt ? new Date(candidate.stoppedAt).getTime() : nowMs;
  const peerById = new Map(entries.map((entry) => [entry.id, entry]));
  const sharedMs = (entry: OverlapPeerEntry) => Math.min(stop, entry.stoppedAt ? new Date(entry.stoppedAt).getTime() : nowMs) -
    Math.max(start, new Date(entry.startedAt).getTime());
  // Name the block it overlaps most.
  const first = overlap.overlappingEntryIds
    .map((id) => peerById.get(id))
    .filter((entry): entry is OverlapPeerEntry => Boolean(entry))
    .sort((a, b) => sharedMs(b) - sharedMs(a))[0];
  const firstName = first?.categoryName?.trim() || first?.description?.trim() || "another block";
  const others = overlap.overlapCount - 1;
  const what = others > 0 ? `${firstName} and ${others} more` : firstName;
  // "Most of this block": strictly more than half, measured in milliseconds on both sides.
  const shared = mergedSharedMs(
    overlap.overlappingEntryIds
      .map((id) => peerById.get(id))
      .filter((entry): entry is OverlapPeerEntry => Boolean(entry))
      .map((entry) => [Math.max(start, new Date(entry.startedAt).getTime()), Math.min(stop, entry.stoppedAt ? new Date(entry.stoppedAt).getTime() : nowMs)] as const)
  );
  const large = stop > start && shared > (stop - start) * LARGE_OVERLAP_SHARE;
  return (
    <p className={`df-roverlap df-tnum${large ? " is-large" : ""}`}>
      {large ? <AlertTriangle aria-hidden="true" size={14} /> : null}
      <span>
        Overlaps {what} by {formatDuration(overlap.uniqueOverlapSeconds)}
        {large ? " · most of this block" : ""}
      </span>
    </p>
  );
}

function mergedSharedMs(ranges: ReadonlyArray<readonly [number, number]>) {
  const sorted = ranges.filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let open: [number, number] | null = null;
  for (const [from, to] of sorted) {
    if (open && from <= open[1]) open[1] = Math.max(open[1], to);
    else {
      if (open) total += open[1] - open[0];
      open = [from, to];
    }
  }
  return open ? total + open[1] - open[0] : total;
}
