import { paletteColorFor } from "@dayframe/shared";
import { formatDuration, formatSourceLabel } from "@/lib/format";
import type { ReportRow } from "@/lib/queries";

export function ReportBars({
  title,
  rows
}: {
  title: string;
  rows: ReportRow[];
}) {
  const max = Math.max(...rows.map((row) => row.seconds), 1);
  const isSourceReport = title.toLowerCase().includes("source");

  return (
    <section className="industrial-panel report-card">
      <div className="report-card-header">
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="space-y-4 p-4">
        {rows.length === 0 ? <p className="text-sm text-[var(--muted)]">No time yet.</p> : null}
        {rows.map((row) => {
          const color = paletteColorFor(row.color, row.name);
          return (
          <div key={row.id} className="report-bar-row motion-row">
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2 font-semibold">
                <span
                  className="h-3 w-3 shrink-0 rounded-full border border-[var(--line-strong)]"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate">{isSourceReport ? formatSourceLabel(row.name) : row.name}</span>
              </span>
              <span className="tabular text-[var(--muted)]">{formatDuration(row.seconds)}</span>
            </div>
            <div className="report-bar-track">
              <div
                className="report-bar-fill"
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
