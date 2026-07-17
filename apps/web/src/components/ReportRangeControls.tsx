import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReportRange } from "@/lib/report-range";

export function ReportRangeControls({ range }: { range: ReportRange }) {
  const href = (period: string, start: string, end?: string) =>
    `/reports?${new URLSearchParams({ period, start, ...(end ? { end } : {}) }).toString()}`;

  return (
    <section className="industrial-panel report-range-controls" aria-label="Report date range">
      <div className="report-range-presets">
        {(["day", "week", "month", "custom"] as const).map((period) => (
          <Link
            key={period}
            href={href(period, range.startKey, period === "custom" ? range.endKey : undefined)}
            className={range.period === period ? "is-selected" : undefined}
          >
            {period[0].toUpperCase() + period.slice(1)}
          </Link>
        ))}
      </div>
      <div className="report-range-navigation">
        <Link href={href(range.period, range.previousStartKey)} aria-label="Previous report period">
          <ChevronLeft aria-hidden="true" size={18} />
        </Link>
        <strong>{range.label}</strong>
        <Link href={href(range.period, range.nextStartKey)} aria-label="Next report period">
          <ChevronRight aria-hidden="true" size={18} />
        </Link>
      </div>
      <form className="report-range-calendar" action="/reports">
        <input type="hidden" name="period" value={range.period} />
        <label>
          <span>From</span>
          <input type="date" name="start" defaultValue={range.startKey} />
        </label>
        {range.period === "custom" ? (
          <label>
            <span>To</span>
            <input type="date" name="end" defaultValue={range.endKey} />
          </label>
        ) : null}
        <button type="submit">Apply</button>
      </form>
    </section>
  );
}
