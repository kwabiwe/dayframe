import { categoryDisplay } from "@/lib/display";
import { formatDuration, formatSourceLabel } from "@/lib/format";
import type { ReportRow } from "@/lib/queries";

export function ReportBars({
  title,
  rows
}: {
  title: string;
  rows: ReportRow[];
}) {
  const total = rows.reduce((sum, row) => sum + row.seconds, 0);
  const max = Math.max(...rows.map((row) => row.seconds), 1);
  const isSourceReport = title.toLowerCase().includes("source");

  return (
    <section className="industrial-panel report-card">
      <div className="report-card-header report-list-header">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{rows.length} item{rows.length === 1 ? "" : "s"}</p>
        </div>
        <strong className="tabular text-sm text-[var(--accent-text)]">{formatDuration(total)}</strong>
      </div>
      <div className="report-list-body">
        {rows.length === 0 ? (
          <div className="reports-empty-state">
            <strong>No time yet</strong>
            <span>Tracked entries will appear here after a timer or manual entry is saved.</span>
          </div>
        ) : null}
        {rows.map((row) => {
          const category = categoryDisplay(row.name, row.color);
          const color = category.color;
          const share = total > 0 ? Math.round((row.seconds / total) * 100) : 0;
          return (
            <div key={row.id} className="report-bar-row motion-row">
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2 font-semibold">
                  <span
                    className={`h-3 w-3 shrink-0 rounded-full border border-[var(--line-strong)]${category.isUncategorized ? " is-uncategorized" : ""}`}
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate">{isSourceReport ? formatSourceLabel(row.name) : row.name}</span>
                </span>
                <span className="tabular shrink-0 text-[var(--muted)]">
                  {formatDuration(row.seconds)} / {share}%
                </span>
              </div>
              <div className="report-bar-track">
                <div
                  className={`report-bar-fill${category.isUncategorized ? " is-uncategorized" : ""}`}
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
