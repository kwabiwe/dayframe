import { paletteColorFor } from "@dayframe/shared";
import type { TimeEntryRow } from "@/lib/queries";
import { formatDuration } from "@/lib/format";

type Segment = {
  id: string;
  name: string;
  seconds: number;
  color: string;
};

export function TimeAllocationPie({ entries }: { entries: TimeEntryRow[] }) {
  const segments = Array.from(
    entries.reduce((totals, entry) => {
      const id = entry.categoryId ?? "needs-category";
      const name = entry.categoryName ?? "Needs category";
      const current = totals.get(id) ?? { name, seconds: 0, color: entry.categoryColor };
      totals.set(id, {
        name: current.name,
        seconds: current.seconds + entry.durationSeconds,
        color: current.color ?? entry.categoryColor
      });
      return totals;
    }, new Map<string, { name: string; seconds: number; color: string | null }>())
  )
    .map<Segment>(([id, value]) => ({
      id,
      name: value.name,
      seconds: value.seconds,
      color: paletteColorFor(value.color, value.name)
    }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5);

  const total = segments.reduce((sum, segment) => sum + segment.seconds, 0);
  let cursor = 0;
  const background =
    total > 0
      ? `conic-gradient(from -90deg, ${segments
          .map((segment) => {
            const start = cursor;
            const size = (segment.seconds / total) * 100;
            cursor += size;
            return `${segment.color} ${start}% ${cursor}%`;
          })
          .join(", ")})`
      : "conic-gradient(from -90deg, var(--surface-muted) 0% 100%)";

  return (
    <section className="industrial-panel">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-lg font-semibold">Time spent</h2>
      </div>
      <div className="grid gap-5 p-4">
        <div
          className="time-donut relative mx-auto aspect-square w-full max-w-[240px] rounded-full border border-[var(--line-strong)] bg-[var(--surface-inset)]"
          style={{ background }}
          aria-label={`Time spent total ${formatDuration(total)}`}
        >
          <div className="absolute inset-[30%] grid place-items-center rounded-full border border-[var(--line-strong)] bg-[var(--surface)]">
            <span className="tabular text-xl font-semibold text-[var(--accent)]">
              {formatDuration(total)}
            </span>
          </div>
        </div>
        <div className="space-y-3">
          {segments.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No time entries yet.</p>
          ) : null}
          {segments.map((segment) => {
            const share = total > 0 ? Math.round((segment.seconds / total) * 100) : 0;
            return (
              <div
                key={segment.id}
                className="grid grid-cols-[14px_minmax(0,1fr)_max-content] items-center gap-3 text-sm"
                title={`${segment.name}: ${formatDuration(segment.seconds)} / ${share}%`}
              >
                <span
                  className="h-3 w-3 border border-[var(--line-strong)]"
                  style={{ backgroundColor: segment.color }}
                />
                <span className="min-w-0 truncate font-medium">{segment.name}</span>
                <span className="tabular text-[var(--muted)]">
                  {formatDuration(segment.seconds)} / {share}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
