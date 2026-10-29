/**
 * Departure and arrival accuracy bursts (location v4 §10, B9; card K, owner decision 29 Oct 2026): leaving or
 * reaching a saved place runs the location task at best accuracy for 3 minutes, so a trip's start and end are
 * sharp. A 14-day trial on this iPhone: days 0–6 on, 7–13 off, then off until the owner decides. Every rule here
 * is pure; `geofence.ts` applies it to Core Location and keeps the state.
 */

export const ACCURACY_BURST_DURATION_MS = 3 * 60_000;
/** A burst can't start within this long of the last one ending. */
export const ACCURACY_BURST_COOLDOWN_MS = 5 * 60_000;
export const ACCURACY_BURST_MAX_PER_DAY = 6;
/** Under the 20 minutes a day at best accuracy the location energy budget allows (performance.md). */
export const ACCURACY_BURST_MAX_SECONDS_PER_DAY = 18 * 60;
export const ACCURACY_BURST_TRIAL_ON_DAYS = 7;
export const ACCURACY_BURST_TRIAL_DAYS = 14;

export type AccuracyBurstKind = "departure" | "arrival";
export type AccuracyBurstArm = "on" | "off" | "done";

export type AccuracyBurstDay = { count: number; seconds: number };

export type AccuracyBurstState = {
  /** The trial's first day, this iPhone's local date (YYYY-MM-DD). */
  startedDay: string;
  active?: { kind: AccuracyBurstKind; startedAt: string; endsAt: string };
  lastEndedAt?: string;
  /** Bursts by local day: how many started, and their seconds at best accuracy. */
  days: Record<string, AccuracyBurstDay>;
};

/** The local calendar day of a moment (YYYY-MM-DD), as the trial counts days. */
export function localDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayNumber(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** A new trial, starting today. */
export function startAccuracyBurstTrial(now: Date): AccuracyBurstState {
  return { startedDay: localDayKey(now), days: {} };
}

/** The trial day (0 on the first day), by local calendar day, so a time-zone change never skips one. */
export function accuracyBurstTrialDay(state: Pick<AccuracyBurstState, "startedDay">, now: Date) {
  return dayNumber(localDayKey(now)) - dayNumber(state.startedDay);
}

export function accuracyBurstArm(state: Pick<AccuracyBurstState, "startedDay">, now: Date): AccuracyBurstArm {
  return armForTrialDay(accuracyBurstTrialDay(state, now));
}

function armForTrialDay(day: number): AccuracyBurstArm {
  if (day < 0 || day >= ACCURACY_BURST_TRIAL_DAYS) return "done";
  return day < ACCURACY_BURST_TRIAL_ON_DAYS ? "on" : "off";
}

export type AccuracyBurstDecision =
  | { start: true }
  | { start: false; reason: "trial_off" | "trial_done" | "active" | "cooldown" | "daily_count" | "daily_time" };

/** Whether a departure or arrival now starts a burst. */
export function accuracyBurstDecision(state: AccuracyBurstState, now: Date): AccuracyBurstDecision {
  const arm = accuracyBurstArm(state, now);
  if (arm === "off") return { start: false, reason: "trial_off" };
  if (arm === "done") return { start: false, reason: "trial_done" };
  if (state.active && Date.parse(state.active.endsAt) > now.getTime()) return { start: false, reason: "active" };
  const lastEnded = state.lastEndedAt ? Date.parse(state.lastEndedAt) : NaN;
  if (Number.isFinite(lastEnded) && now.getTime() - lastEnded < ACCURACY_BURST_COOLDOWN_MS) return { start: false, reason: "cooldown" };
  const today = state.days[localDayKey(now)] ?? { count: 0, seconds: 0 };
  if (today.count >= ACCURACY_BURST_MAX_PER_DAY) return { start: false, reason: "daily_count" };
  // Room for a whole burst, so the day never passes its cap.
  if (today.seconds + ACCURACY_BURST_DURATION_MS / 1000 > ACCURACY_BURST_MAX_SECONDS_PER_DAY) return { start: false, reason: "daily_time" };
  return { start: true };
}

export function startAccuracyBurst(state: AccuracyBurstState, kind: AccuracyBurstKind, now: Date): AccuracyBurstState {
  const key = localDayKey(now);
  const today = state.days[key] ?? { count: 0, seconds: 0 };
  return {
    ...state,
    active: { kind, startedAt: now.toISOString(), endsAt: new Date(now.getTime() + ACCURACY_BURST_DURATION_MS).toISOString() },
    days: { ...state.days, [key]: { ...today, count: today.count + 1 } }
  };
}

/** True when a burst is running past its 3 minutes and normal capture should come back. */
export function accuracyBurstDue(state: AccuracyBurstState, now: Date) {
  return Boolean(state.active && Date.parse(state.active.endsAt) <= now.getTime());
}

/**
 * Ends the running burst (on time, or early: sign-out, location off): its seconds at best accuracy, never more
 * than 3 minutes, are added to the day it started.
 */
export function endAccuracyBurst(state: AccuracyBurstState, now: Date): AccuracyBurstState {
  if (!state.active) return state;
  const started = Date.parse(state.active.startedAt);
  const ended = Math.min(now.getTime(), Date.parse(state.active.endsAt));
  const seconds = Math.max(0, Math.round((ended - started) / 1000));
  const key = localDayKey(new Date(started));
  const day = state.days[key] ?? { count: 0, seconds: 0 };
  const { active: _active, ...rest } = state;
  return { ...rest, lastEndedAt: new Date(ended).toISOString(), days: { ...state.days, [key]: { ...day, seconds: day.seconds + seconds } } };
}

/** Sync help's line: "Accuracy trial day 3 of 14 · on · 2 bursts today (6m)". */
export function accuracyBurstSummaryLine(state: AccuracyBurstState | null | undefined, now: Date) {
  if (!state) return "Accuracy trial: not started";
  const arm = accuracyBurstArm(state, now);
  if (arm === "done") return "Accuracy trial finished";
  const today = state.days[localDayKey(now)] ?? { count: 0, seconds: 0 };
  const minutes = Math.round(today.seconds / 60);
  return `Accuracy trial day ${accuracyBurstTrialDay(state, now) + 1} of ${ACCURACY_BURST_TRIAL_DAYS} · bursts ${arm} · ` +
    `${today.count} ${today.count === 1 ? "burst" : "bursts"} today (${minutes}m)`;
}

/** The per-day table for shared diagnostics: day, arm, count, seconds. No places, times of day or positions. */
export function accuracyBurstDiagnostics(state: AccuracyBurstState | null | undefined) {
  if (!state) return [];
  return Object.entries(state.days).sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({
    day,
    arm: armForTrialDay(dayNumber(day) - dayNumber(state.startedDay)),
    count: value.count,
    seconds: value.seconds
  }));
}
