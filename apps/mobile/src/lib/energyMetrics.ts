// Location v4 step 3 (design §10, B9): MetricKit's daily energy metrics, measured before any
// detailed-tracking burst is considered. Native keeps one record a day as counts (no positions):
// time at each location accuracy, background and foreground time, and CPU. Sync help shows the
// average of the newest seven days against the best-accuracy budget (20 minutes a day).
import { formatDuration } from "@dayframe/shared";

export type NativeEnergySummary = {
  days: number;
  bestAccuracySecondsPerDay: number;
  backgroundLocationSecondsPerDay: number;
  backgroundSecondsPerDay: number;
  cpuSecondsPerDay: number;
  daysOverBudget: number;
  bestAccuracyBudgetSeconds: number;
};

export type NativeEnergyDay = {
  begin: string;
  end: string;
  appVersion?: string | null;
  bestAccuracySeconds: number;
  tenMetresSeconds: number;
  hundredMetresSeconds: number;
  kilometreSeconds: number;
  threeKilometresSeconds: number;
  foregroundSeconds: number;
  backgroundSeconds: number;
  backgroundLocationSeconds: number;
  cpuSeconds: number;
};

/** Minutes and hours like the rest of Dayframe; under a minute in seconds (CPU is often small). */
function duration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  return seconds < 60 ? `${Math.round(seconds)}s` : formatDuration(seconds);
}

/** Sync help's "Location energy" line, or the waiting text before iOS has sent a day. */
export function energySummaryLine(summary: NativeEnergySummary | null | undefined) {
  if (!summary || !summary.days) return "Not reported yet: iOS sends these about once a day";
  const days = `${summary.days} ${summary.days === 1 ? "day" : "days"}`;
  const over = summary.daysOverBudget
    ? ` · over ${duration(summary.bestAccuracyBudgetSeconds)} on ${summary.daysOverBudget} ${summary.daysOverBudget === 1 ? "day" : "days"}`
    : "";
  return `Best accuracy ${duration(summary.bestAccuracySecondsPerDay)} a day (budget ${duration(summary.bestAccuracyBudgetSeconds)})${over}`
    + ` · background location ${duration(summary.backgroundLocationSecondsPerDay)}`
    + ` · CPU ${duration(summary.cpuSecondsPerDay)} · average of ${days}`;
}

/** For "Copy details for support": the summary and every stored day, counts only. */
export function supportEnergyDiagnostics(summary: NativeEnergySummary | null | undefined, days: NativeEnergyDay[] | null | undefined) {
  if (!summary && !days?.length) return null;
  return { summary: summary ?? null, days: (days ?? []).slice(-30) };
}
