/**
 * Departure and arrival accuracy bursts (location v4 §10, B9; card K, owner decision 29 Oct 2026): leaving or
 * reaching a saved place, or an iOS Visit's departure or arrival at any place, runs the location task at best
 * accuracy for 3 minutes, so a trip's start and end are sharp. A 14-day trial on this iPhone: days 0–6 on, 7–13
 * off, then off until the owner decides. Every rule here is pure; `geofence.ts` applies it to Core Location and
 * keeps the state.
 */

export const ACCURACY_BURST_DURATION_MS = 3 * 60_000;
/** A burst can't start within this long of the last one ending. */
export const ACCURACY_BURST_COOLDOWN_MS = 5 * 60_000;
/** A burst still recorded this long past its 3 minutes stops location updates outright (if the day allows that long). */
export const ACCURACY_BURST_FORCE_STOP_MS = 5 * 60_000;
export const ACCURACY_BURST_MAX_PER_DAY = 6;
/** Under the 20 minutes a day at best accuracy the location energy budget allows (performance.md). */
export const ACCURACY_BURST_MAX_SECONDS_PER_DAY = 18 * 60;
export const ACCURACY_BURST_TRIAL_ON_DAYS = 7;
export const ACCURACY_BURST_TRIAL_DAYS = 14;

export type AccuracyBurstKind = "departure" | "arrival";
export type AccuracyBurstArm = "on" | "off" | "done";
/**
 * What started a burst: a saved place's geofence, or an iOS Visit at any place (an unknown one too, such as a
 * parked car at a restaurant; orchestrator, 29 Oct 2026). Recorded per burst, so the readout can compare them.
 */
export type AccuracyBurstTrigger = "saved_exit" | "saved_entry" | "visit_departure" | "visit_arrival";

export type AccuracyBurstDay = {
  count: number;
  /** Seconds at best accuracy on this local day, as they really ran (a late end counts in full). */
  seconds: number;
  byTrigger?: Partial<Record<AccuracyBurstTrigger, { count: number; seconds: number }>>;
};

export type AccuracyBurstState = {
  /** The trial's first day, this iPhone's local date (YYYY-MM-DD). */
  startedDay: string;
  /** The furthest trial day reached: a clock set back never turns an off or finished trial on again. */
  furthestTrialDay?: number;
  /** The running burst, until normal capture is back (it stays while a restore hasn't succeeded). */
  active?: {
    kind: AccuracyBurstKind; trigger?: AccuracyBurstTrigger; startedAt: string; endsAt: string;
    /** The capture lifetime that started it: another one never resumes or ends it (Codex r2 on #619). */
    captureId?: string;
    /** The time zone offset when it started (minutes, as `getTimezoneOffset`): its days are counted on that basis. */
    offsetMinutes?: number;
    /**
     * When location updates are stopped outright if normal capture still isn't back: 5 minutes past its 3, and never
     * past the day's remaining best-accuracy allowance (Codex r3 on #619).
     */
    stopBy?: string;
    /**
     * When best accuracy really started (the burst is recorded first, as `startedAt`): its runtime and its day are
     * counted from here, never from the recording (Codex r16 on #619). Absent until written; then `startedAt`.
     */
    nativeStartedAt?: string;
  };
  lastEndedAt?: string;
  /** Bursts by local day: how many started, and their seconds at best accuracy. */
  days: Record<string, AccuracyBurstDay>;
};

export const accuracyBurstTrigger = (kind: AccuracyBurstKind, source: "saved_place" | "visit"): AccuracyBurstTrigger =>
  source === "visit" ? (kind === "departure" ? "visit_departure" : "visit_arrival") : (kind === "departure" ? "saved_exit" : "saved_entry");

/** The local calendar day of a moment (YYYY-MM-DD), as the trial counts days. */
export function localDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The calendar day of a moment at a fixed offset (minutes, as `getTimezoneOffset`). */
const dayKeyAtOffset = (ms: number, offsetMinutes: number) => new Date(ms - offsetMinutes * 60_000).toISOString().slice(0, 10);

function dayNumber(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

const dayKeyFromNumber = (value: number) => new Date(value * 86_400_000).toISOString().slice(0, 10);

/** A new trial, starting today. */
export function startAccuracyBurstTrial(now: Date): AccuracyBurstState {
  return { startedDay: localDayKey(now), furthestTrialDay: 0, days: {} };
}

/**
 * The trial day (0 on the first day), by local calendar day, so a time-zone change never skips one, and never
 * earlier than the furthest day already reached.
 */
export function accuracyBurstTrialDay(state: Pick<AccuracyBurstState, "startedDay" | "furthestTrialDay">, now: Date) {
  return Math.max(dayNumber(localDayKey(now)) - dayNumber(state.startedDay), state.furthestTrialDay ?? Number.NEGATIVE_INFINITY);
}

export function accuracyBurstArm(state: Pick<AccuracyBurstState, "startedDay" | "furthestTrialDay">, now: Date): AccuracyBurstArm {
  return armForTrialDay(accuracyBurstTrialDay(state, now));
}

function armForTrialDay(day: number): AccuracyBurstArm {
  if (!Number.isFinite(day) || day < 0 || day >= ACCURACY_BURST_TRIAL_DAYS) return "done";
  return day < ACCURACY_BURST_TRIAL_ON_DAYS ? "on" : "off";
}

/** The state with the furthest trial day brought up to now (stored with every change). */
export function withTrialProgress(state: AccuracyBurstState, now: Date): AccuracyBurstState {
  const day = accuracyBurstTrialDay(state, now);
  return Number.isFinite(day) && day > (state.furthestTrialDay ?? Number.NEGATIVE_INFINITY) ? { ...state, furthestTrialDay: day } : state;
}

export type AccuracyBurstDecision =
  | { start: true }
  | { start: false; reason: "trial_off" | "trial_done" | "active" | "cooldown" | "daily_count" | "daily_time" };

/**
 * Whether a departure or arrival now starts a burst. A burst still recorded as running (even past its 3 minutes,
 * until normal capture is back) blocks another. A Visit never takes the day's last burst, so when the caps bind
 * a saved place's exit still gets one (orchestrator, 29 Oct 2026).
 */
export function accuracyBurstDecision(
  state: AccuracyBurstState, now: Date, trigger: AccuracyBurstTrigger = "saved_exit"
): AccuracyBurstDecision {
  const arm = accuracyBurstArm(state, now);
  if (arm === "off") return { start: false, reason: "trial_off" };
  if (arm === "done") return { start: false, reason: "trial_done" };
  if (state.active) return { start: false, reason: "active" };
  const lastEnded = state.lastEndedAt ? Date.parse(state.lastEndedAt) : NaN;
  if (Number.isFinite(lastEnded) && now.getTime() - lastEnded < ACCURACY_BURST_COOLDOWN_MS) return { start: false, reason: "cooldown" };
  const today = state.days[localDayKey(now)] ?? { count: 0, seconds: 0 };
  const reserved = trigger === "visit_departure" || trigger === "visit_arrival" ? 1 : 0;
  if (today.count + reserved >= ACCURACY_BURST_MAX_PER_DAY) return { start: false, reason: "daily_count" };
  // Room for a whole burst (and, for a Visit, one more after it), so the day never passes its cap.
  if (today.seconds + (1 + reserved) * ACCURACY_BURST_DURATION_MS / 1000 > ACCURACY_BURST_MAX_SECONDS_PER_DAY) {
    return { start: false, reason: "daily_time" };
  }
  return { start: true };
}

export function startAccuracyBurst(
  state: AccuracyBurstState, kind: AccuracyBurstKind, now: Date, trigger: AccuracyBurstTrigger = accuracyBurstTrigger(kind, "saved_place"),
  captureId?: string
): AccuracyBurstState {
  const key = localDayKey(now);
  const today = state.days[key] ?? { count: 0, seconds: 0 };
  const byTrigger = today.byTrigger ?? {};
  const forTrigger = byTrigger[trigger] ?? { count: 0, seconds: 0 };
  const allowanceMs = Math.max(0, ACCURACY_BURST_MAX_SECONDS_PER_DAY - today.seconds) * 1000;
  const stopBy = new Date(now.getTime() + Math.min(ACCURACY_BURST_DURATION_MS + ACCURACY_BURST_FORCE_STOP_MS, Math.max(allowanceMs, ACCURACY_BURST_DURATION_MS)));
  return {
    ...withTrialProgress(state, now),
    active: {
      kind, trigger, startedAt: now.toISOString(), endsAt: new Date(now.getTime() + ACCURACY_BURST_DURATION_MS).toISOString(),
      ...(captureId ? { captureId } : {}), offsetMinutes: now.getTimezoneOffset(), stopBy: stopBy.toISOString()
    },
    days: { ...state.days, [key]: { ...today, count: today.count + 1, byTrigger: { ...byTrigger, [trigger]: { ...forTrigger, count: forTrigger.count + 1 } } } }
  };
}

/** True when a burst is past its 3 minutes and normal capture should come back. */
export function accuracyBurstDue(state: AccuracyBurstState, now: Date) {
  return Boolean(state.active && Date.parse(state.active.endsAt) <= now.getTime());
}

/**
 * The days between two moments on the burst's own time-zone basis (the offset when it started), so a burst
 * across midnight charges each day its own part and a time-zone change mid-burst never splits its count from
 * its seconds (Codex r2 on #619).
 */
function dayParts(fromMs: number, toMs: number, offsetMinutes: number) {
  const parts: Array<{ key: string; seconds: number }> = [];
  let cursor = fromMs;
  while (cursor < toMs) {
    const key = dayKeyAtOffset(cursor, offsetMinutes);
    const nextMidnight = Date.parse(`${key}T00:00:00.000Z`) + 86_400_000 + offsetMinutes * 60_000;
    const end = Math.min(toMs, nextMidnight > cursor ? nextMidnight : toMs);
    parts.push({ key, seconds: (end - cursor) / 1000 });
    cursor = end;
  }
  return parts;
}

/**
 * Ends the running burst, once normal capture is back (on time, late, or early: sign-out, location off). Its
 * seconds at best accuracy are counted as they really ran, from when best accuracy started (`nativeStartMs`, else
 * the recorded `nativeStartedAt`, else its recording), each local day its own part; a burst that best accuracy
 * started on a later day than it was recorded counts on that day. The cooldown starts from now (Codex r1, r16 on #619).
 */
export function endAccuracyBurst(
  state: AccuracyBurstState, now: Date, elapsedMs?: number, nativeStartMs?: number, unmeasured = false
): AccuracyBurstState {
  if (!state.active) return state;
  const recorded = Date.parse(state.active.startedAt);
  const storedNative = state.active.nativeStartedAt ? Date.parse(state.active.nativeStartedAt) : NaN;
  const started = Math.max(recorded, nativeStartMs != null && Number.isFinite(nativeStartMs) ? nativeStartMs
    : Number.isFinite(storedNative) ? storedNative : recorded);
  // Elapsed time measured while it ran wins over wall-clock timestamps, which a clock change moves (Codex r7 on #619).
  // Without elapsed time, a clock set back behind the start can't measure what ran: the most it could have run, to
  // its hard stop, counts instead (Codex r19 on #619).
  // The hard stop's length, from when best accuracy started: a recording delayed past its own deadline never shrinks
  // it (Codex r20 on #619).
  const hardStop = started + (state.active.stopBy ? Math.max(0, Date.parse(state.active.stopBy) - recorded)
    : ACCURACY_BURST_DURATION_MS + ACCURACY_BURST_FORCE_STOP_MS);
  // Unmeasured (no elapsed time from a lease, after a relaunch): at least to the hard stop, since a clock moved
  // since can't be seen (Codex r21 on #619).
  const ended = elapsedMs != null && Number.isFinite(elapsedMs) ? started + Math.max(0, elapsedMs)
    : now.getTime() < started ? Math.max(started, hardStop)
      : unmeasured ? Math.max(now.getTime(), hardStop) : now.getTime();
  const trigger = state.active.trigger;
  const days = { ...state.days };
  const offsetMinutes = state.active.offsetMinutes ?? new Date(recorded).getTimezoneOffset();
  // The burst's count moves with it to the day best accuracy started, when that's a later day than its recording.
  const recordedDay = dayKeyAtOffset(recorded, offsetMinutes);
  const nativeDay = dayKeyAtOffset(started, offsetMinutes);
  if (nativeDay !== recordedDay && days[recordedDay]) {
    const moveCount = (day: AccuracyBurstDay, delta: number): AccuracyBurstDay => ({
      ...day, count: Math.max(0, day.count + delta),
      ...(trigger ? { byTrigger: { ...day.byTrigger, [trigger]: {
        count: Math.max(0, (day.byTrigger?.[trigger]?.count ?? 0) + delta), seconds: day.byTrigger?.[trigger]?.seconds ?? 0 } } } : {})
    });
    days[recordedDay] = moveCount(days[recordedDay], -1);
    days[nativeDay] = moveCount(days[nativeDay] ?? { count: 0, seconds: 0 }, 1);
  }
  // Without evidence of when best accuracy started, every later day it may have run on counts it too: a day's cap
  // can be met early, never passed (Codex r17 on #619).
  const startKnown = (nativeStartMs != null && Number.isFinite(nativeStartMs)) || Number.isFinite(storedNative);
  for (const part of dayParts(started, ended, offsetMinutes)) {
    const day = days[part.key] ?? { count: 0, seconds: 0 };
    const seconds = Math.round(part.seconds);
    const counted = !startKnown && part.key !== recordedDay ? 1 : 0;
    const byTrigger = trigger ? {
      ...day.byTrigger,
      [trigger]: { count: (day.byTrigger?.[trigger]?.count ?? 0) + counted, seconds: (day.byTrigger?.[trigger]?.seconds ?? 0) + seconds }
    } : day.byTrigger;
    days[part.key] = { ...day, count: day.count + counted, seconds: day.seconds + seconds, ...(byTrigger ? { byTrigger } : {}) };
  }
  const { active: _active, ...rest } = withTrialProgress(state, now);
  return { ...rest, lastEndedAt: new Date(elapsedMs != null ? now.getTime() : ended).toISOString(), days };
}

/** Sync help's line: "Accuracy trial day 3 of 14 · bursts on · 2 bursts today (6m)". */
export function accuracyBurstSummaryLine(state: AccuracyBurstState | null | undefined, now: Date) {
  if (!state) return "Accuracy trial: not started";
  const arm = accuracyBurstArm(state, now);
  if (arm === "done") return "Accuracy trial finished";
  const today = state.days[localDayKey(now)] ?? { count: 0, seconds: 0 };
  const minutes = Math.round(today.seconds / 60);
  return `Accuracy trial day ${accuracyBurstTrialDay(state, now) + 1} of ${ACCURACY_BURST_TRIAL_DAYS} · bursts ${arm} · ` +
    `${today.count} ${today.count === 1 ? "burst" : "bursts"} today (${minutes}m)`;
}

/**
 * The per-day table for shared diagnostics: every trial day so far, off days and days with no burst included
 * (the readout's baseline), and any other day with bursts. Day, arm, count, seconds (and by trigger) only: no
 * places, times of day or positions.
 */
export function accuracyBurstDiagnostics(state: AccuracyBurstState | null | undefined, now: Date) {
  if (!state) return [];
  const first = dayNumber(state.startedDay);
  const reached = Math.min(ACCURACY_BURST_TRIAL_DAYS - 1, Math.max(0, accuracyBurstTrialDay(state, now)));
  const keys = new Set<string>(Object.keys(state.days));
  for (let day = first; day <= first + reached; day += 1) keys.add(dayKeyFromNumber(day));
  return [...keys].sort().map((day) => {
    const value = state.days[day] ?? { count: 0, seconds: 0 };
    return {
      day,
      arm: armForTrialDay(dayNumber(day) - first),
      count: value.count,
      seconds: value.seconds,
      ...(value.byTrigger ? { byTrigger: value.byTrigger } : {})
    };
  });
}
