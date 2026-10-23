import { localDayTime, median, p90, type DayResult, type QualityReport } from "./score";

/**
 * Fixed-point formatting that rounds an exact binary half to even, as Python's format() does, so the
 * report reads the same as the design's prototype on the same run.
 */
export function fixed(value: number, digits: number): string {
  const scale = 10 ** digits;
  const scaled = value * scale;
  if (Number.isInteger(scaled * 2) && !Number.isInteger(scaled)) {
    const floor = Math.floor(scaled);
    return ((floor % 2 === 0 ? floor : floor + 1) / scale).toFixed(digits);
  }
  return value.toFixed(digits);
}

export const pct = (n: number, d: number) => (d ? `${fixed((100 * n) / d, 0)}%` : "–");
const pad = (value: string | number, width: number) => String(value).padStart(width);

function errors(values: number[]): string {
  if (!values.length) return "–";
  const abs = values.map(Math.abs);
  return `median ${fixed(median(abs), 1)} min, p90 ${fixed(p90(abs), 1)} min, ≤5 min ${pct(abs.filter((v) => v <= 5).length, abs.length)}`;
}

function dayRow(r: DayResult): string {
  const c = r.components;
  return `${r.label.padEnd(10)} ${pad(fixed(r.score, 0), 5)}  ${fixed(c.kind, 2)}  ${fixed(c.stays, 2)}   ${fixed(c.bounds, 2)}   ${fixed(c.trips, 2)}  ${fixed(c.mode, 2)} | `
    + `${pad(r.keyStays, 2)}/${pad(r.engineStays, 2)}/${pad(r.stayMatched, 2)} ${pad(r.phantomStays, 2)} ${pad(r.splitStays, 2)}        | `
    + `${pad(r.keyTrips, 2)}/${pad(r.engineMoves, 2)}/${pad(r.tripMatched, 2)} ${pad(r.phantomMoves, 2)}      | `
    + `${pad(r.travelMinutes, 4)} ${pad(pct(r.modeFine, r.travelMinutes), 4)}/${pad(pct(r.modeCoarse, r.travelMinutes), 4)}`;
}

/** The human report: minutes, counts, metres, anonymous place labels and local times only. */
export function renderReport(report: QualityReport, timeZone: string, options: { detail?: boolean } = {}): string {
  const at = localDayTime(timeZone);
  const R = report.week;
  const c = R.components;
  const cell = (k: string, e: string) => R.confusion.get(`${k}/${e}`) ?? 0;
  const out: string[] = [];
  out.push(`Answer key window ${at(report.window.a)} → ${at(report.window.b)} (local). Google: ${report.key.stays} stays, ${report.key.trips} trips, `
    + `${report.key.legs} legs; stay ${report.key.stayMinutes} min, travel ${report.key.travelMinutes} min; `
    + `answer key unsure (gap fillers excluded) ${report.key.unsureMinutes} min.`);
  out.push(`Engine: ${report.engine.stays} stays, ${report.engine.moves} moves.`, "");
  out.push("Day        score  kind  stayF1 bounds tripF1 mode | stays g/e/match phantom split | trips g/e/match phantom | travel min, fine/coarse mode");
  for (const day of report.days) out.push(dayRow(day));
  out.push("");
  out.push(`WEEK score ${fixed(R.score, 0)}  (kind ${fixed(c.kind, 2)} · stays ${fixed(c.stays, 2)} · bounds ${fixed(c.bounds, 2)} · trips ${fixed(c.trips, 2)} · mode ${fixed(c.mode, 2)})`);
  out.push(`Coverage: ${pct(R.covered, R.minutes)} of ${R.minutes} answer-key minutes have a Stay or Move; kind agrees on ${pct(R.agree, R.minutes)}.`);
  out.push(`  Google stay minutes → engine stay ${cell("stay", "stay")}, move ${cell("stay", "travel")}, nothing ${cell("stay", "none")}`);
  out.push(`  Google travel minutes → engine move ${cell("travel", "travel")}, stay ${cell("travel", "stay")}, nothing ${cell("travel", "none")}`);
  out.push(`Stays ≥10 min: Google ${R.keyStays}, engine ${R.engineStays} (scored where Google is sure), matched ${R.stayMatched} (recall ${pct(R.stayMatched, R.keyStays)}, `
    + `precision ${fixed(100 * R.stayPrecision, 0)}%); phantom ${R.phantomStays}; split ${R.splitStays}`);
  out.push(`  start error: ${errors(R.stayStartErrors)}`);
  out.push(`  end error:   ${errors(R.stayEndErrors)}`);
  out.push(`  Home stays matched to the Home place: ${R.home[0]}/${R.home[1]}`);
  out.push(`Trips: Google ${R.keyTrips} (${R.multiLegTrips} with more than one leg); found ${R.tripMatched} (recall ${pct(R.tripMatched, R.keyTrips)}); `
    + `engine Moves ${R.engineMoves}, phantom ${R.phantomMoves} (precision ${fixed(100 * R.movePrecision, 0)}%); Move minutes inside Google stays ${R.phantomTravelMinutes}`);
  out.push(`  start error: ${errors(R.tripStartErrors)}`);
  out.push(`  end error:   ${errors(R.tripEndErrors)}`);
  out.push(`  leg count right: ${R.legs[0]}/${R.legs[1]} matched trips`);
  out.push(`  multi-leg trips split into the right legs: 0/${R.multiLegFound} (the engine has no legs today)`);
  const dp = R.distancePairs;
  if (dp.length) {
    const ratios = dp.map((p) => p.engineRouteM / p.keyM).sort((x, y) => x - y);
    out.push(`Drive distance, engine route vs Google (${dp.length} single-leg drives over 500 m): median ratio ${fixed(median(ratios), 2)}, `
      + `range ${fixed(ratios[0], 2)}–${fixed(ratios[ratios.length - 1], 2)}, within ±5% ${ratios.filter((x) => Math.abs(x - 1) <= 0.05).length}/${ratios.length}, `
      + `within ±10% ${ratios.filter((x) => Math.abs(x - 1) <= 0.1).length}/${ratios.length}`);
    const rate = dp.filter((p) => p.minutes > 0).map((p) => p.routeSamples / p.minutes);
    out.push(`  route readings per minute of driving: median ${fixed(median(rate), 1)}`);
  }
  out.push(`Mode by travel minute: fine ${pct(R.modeFine, R.travelMinutes)}, coarse ${pct(R.modeCoarse, R.travelMinutes)} of ${R.travelMinutes} min`);
  for (const [mode, count] of R.byMode) out.push(`  ${mode.padEnd(12)} ${pad(count, 4)} min, right ${pct(R.byModeRight.get(mode) ?? 0, count)}`);
  out.push("", "Bars (events in window; Wilson 90% lower bound):");
  for (const bar of report.bars) out.push(`  ${bar.label}: ${bar.right}/${bar.total}  lower bound ${fixed(100 * bar.lowerBound, 0)}%`);
  if (options.detail) {
    out.push("", "Detail (local times):");
    for (const line of report.detail) out.push(`  ${line}`);
  }
  return `${out.join("\n")}\n`;
}

/** The machine summary: the week and day scores with their parts. */
export function summary(report: QualityReport) {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const day = (r: DayResult) => ({
    label: r.label,
    score: round(r.score),
    components: Object.fromEntries(Object.entries(r.components).map(([name, value]) => [name, round(value)]))
  });
  return {
    week: day(report.week),
    days: report.days.map(day),
    bars: report.bars.map((bar) => ({ ...bar, lowerBound: round(bar.lowerBound) }))
  };
}
