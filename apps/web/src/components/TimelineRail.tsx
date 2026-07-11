import {
  timeEntryAccentColor,
  timeEntryCategoryLabel,
  timeEntryContextLabel,
  timeEntryTitle
} from "@/lib/display";
import type { TimeEntryRow } from "@/lib/queries";
import { formatDuration, formatSourceLabel, formatTime } from "@/lib/format";

export function TimelineRail({ entries }: { entries: TimeEntryRow[] }) {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );

  return (
    <section className="time-grid industrial-panel">
      <div className="grid grid-cols-[72px_1fr]">
        <div className="border-r border-[var(--line)] bg-[var(--surface-inset)]">
          {Array.from({ length: 12 }).map((_, index) => (
            <div
              key={index}
              className="tabular h-[38px] border-b border-[var(--line)] px-3 py-2 text-xs text-[var(--muted)]"
            >
              {`${index + 8}:00`}
            </div>
          ))}
        </div>
        <div className="min-h-[456px] p-4">
          <div className="space-y-3">
            {sorted.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No entries for this timeline yet.</p>
            ) : null}
            {sorted.map((entry) => (
              <article
                key={entry.id}
                className="motion-row border border-l-4 border-[var(--line)] bg-[var(--surface-inset)] px-4 py-3"
                style={{ borderLeftColor: timeEntryAccentColor(entry) }}
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-base font-semibold">{timeEntryTitle(entry)}</h3>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {timeEntryContextLabel(entry)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                      <span>{timeEntryCategoryLabel(entry)}</span>
                      <span>{entry.placeName ?? "No place"}</span>
                      <span>{formatSourceLabel(entry.source)}</span>
                    </div>
                  </div>
                  <div className="tabular text-left text-sm md:text-right">
                    <div>
                      {formatTime(entry.startedAt)} -{" "}
                      {entry.stoppedAt ? formatTime(entry.stoppedAt) : "Running"}
                    </div>
                    <div className="mt-1 font-semibold text-[var(--accent-text)]">
                      {formatDuration(entry.durationSeconds)}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
