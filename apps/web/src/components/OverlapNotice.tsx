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
          Overlaps {overlap.overlapCount === 1 ? "one entry" : `${overlap.overlapCount} entries`} by {duration}
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
            Overlaps {overlap.overlapCount} {overlap.overlapCount === 1 ? "entry" : "entries"}{" "}
            {overlap.overlapCount === 1 ? "by" : "across"} {duration}
          </strong>
        </p>
        {visiblePeers.length > 0 ? (
          <ul>
            {visiblePeers.map((entry) => (
              <li key={entry.id}>
                {entry.description?.trim() || entry.categoryName?.trim() || "Untitled entry"}
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
