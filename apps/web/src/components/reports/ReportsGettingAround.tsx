import Link from "next/link";
import { DAYFRAME_LEG_MODE_ICONS, LEG_MODE_LABEL, type DayframeGlyph, type GettingAroundSummary } from "@dayframe/shared";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { formatDuration } from "@/lib/format";

/**
 * Reports › Getting around (location v4 step 18, design §12, mock-up #web-reports): the time inside
 * Getting around and Commute blocks, split by leg mode, each trip counted once. Times only: no
 * distances or mileage (owner, 23 Oct). A trip already counts once as its activity above; this card
 * only splits that time.
 */
export function ReportsGettingAround({ summary }: { summary: GettingAroundSummary | null }) {
  if (!summary || summary.totalSeconds <= 0) return null;
  const rows = [
    ...summary.byMode.map((row) => ({
      key: row.mode,
      label: row.mode === "unknown" ? "Mode not known" : LEG_MODE_LABEL[row.mode],
      glyph: (row.mode === "unknown" ? "route" : DAYFRAME_LEG_MODE_ICONS[row.mode]) as DayframeGlyph,
      seconds: row.seconds
    })),
    ...(summary.stopsSeconds > 0 ? [{ key: "stops", label: "Stops and changes", glyph: "timer" as DayframeGlyph, seconds: summary.stopsSeconds }] : [])
  ].sort((a, b) => b.seconds - a.seconds);
  const total = Math.max(1, summary.totalSeconds);
  return (
    <section aria-labelledby="df-getting-around-title" className="df-card df-getting-around">
      <div className="df-card-head">
        <h2 id="df-getting-around-title">Getting around</h2>
      </div>
      <div className="df-getting-around-total">
        <span className="df-stat-big df-tnum">{formatDuration(summary.totalSeconds)}</span>
        <span className="df-faint">{summary.tripCount} {summary.tripCount === 1 ? "trip" : "trips"}, each counted once</span>
      </div>
      <div aria-hidden="true" className="df-getting-around-bar">
        {rows.map((row) => (
          <span data-mode={row.key} key={row.key} style={{ width: `${(row.seconds / total) * 100}%` }} />
        ))}
      </div>
      <ul className="df-getting-around-rows">
        {rows.map((row) => (
          <li key={row.key}>
            <span aria-hidden="true" className="df-getting-around-icon"><DayframeIcon glyph={row.glyph} size={16} /></span>
            <b>{row.label}</b>
            <span className="df-tnum">{formatDuration(row.seconds)}</span>
          </li>
        ))}
      </ul>
      <p className="df-faint df-getting-around-note">Time by leg inside your Getting around and Commute blocks.</p>
    </section>
  );
}

/** "Not logged" under the total: time at places you haven't named, never part of activities or goals. */
export function ReportsNotLogged({ seconds }: { seconds: number }) {
  if (seconds < 60) return null;
  return (
    <p className="df-report-footnote df-report-not-logged">
      Not logged: <b className="df-tnum">{formatDuration(seconds)}</b> at places you haven&apos;t named.{" "}
      <Link href="/timeline?view=list&scope=day">Check them</Link>. Not counted above or in goals.
    </p>
  );
}
