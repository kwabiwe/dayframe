import { paletteColorFor } from "@dayframe/shared";
import { formatDuration } from "@/lib/format";
import type { ReportRow } from "@/lib/queries";

export function ReportBars({
  title,
  rows
}: {
  title: string;
  rows: ReportRow[];
}) {
  const max = Math.max(...rows.map((row) => row.seconds), 1);

  return (
    <section className="industrial-panel">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="space-y-3 p-4">
        {rows.length === 0 ? <p className="text-sm text-[var(--muted)]">No time yet.</p> : null}
        {rows.map((row) => {
          const color = paletteColorFor(row.color, row.name);
          return (
          <div key={row.id} className="motion-row">
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2 font-medium">
                <span
                  className="h-3 w-3 shrink-0 border border-[var(--line-strong)]"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate">{row.name}</span>
              </span>
              <span className="tabular text-[var(--muted)]">{formatDuration(row.seconds)}</span>
            </div>
            <div className="h-2 border border-[var(--line-strong)] bg-[var(--surface-inset)]">
              <div
                className="h-full transition-[width] duration-300 ease-out"
                style={{ width: `${Math.max(4, (row.seconds / max) * 100)}%`, backgroundColor: color }}
              />
            </div>
          </div>
          );
        })}
      </div>
    </section>
  );
}
