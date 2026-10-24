// The JS half of the freeze watchdog (staging freeze, 22 Oct 2026: no hang report, no requests). While
// Dayframe is in front, JS answers native once a second; native records any stretch of 3 s or more
// without an answer, with the labelled JS tasks then running (`jsTasks.ts`), and saves it at once, so a
// force-close keeps it. Native also watches the main thread and saves MetricKit hang and crash reports.
// Everything stays on this iPhone until the person shares Sync help's support details.
import type { NativeEnergyDay, NativeEnergySummary } from "./energyMetrics";
import { setJsTaskSink, type JsTaskLabel } from "./jsTasks";

export type NativeDiagnostics = {
  jsAnswered(): void;
  setJsTasks(tasks: JsTaskLabel[], last: JsTaskLabel | null): void;
  /** The last few pauses and the report count, without payloads (Sync help's line). */
  overview(): Promise<NativeDiagnosticsSnapshot>;
  /** Everything, for "Copy details for support". */
  snapshot(): Promise<NativeDiagnosticsSnapshot>;
  clear(): Promise<void>;
};

export type NativeStallRecord = {
  id: string;
  thread: "js" | "main";
  startedAt: string;
  durationMs: number;
  outcome?: "recovered" | "left" | null;
  jsTasks: string[];
  lastJsTask?: string | null;
  appBuild?: string | null;
  /** The app binary's UUID: which dSYM symbolicates `mainSamples` (staging builds share build 1). */
  appBinary?: string | null;
  /** A main stall's stack, sampled as it opens and every 10 s (at most 4): `image+0xoffset` frames. */
  mainSamples?: Array<{ atMs: number; frames: string[] }>;
  /** Binary name → UUID for the images in `mainSamples`. */
  images?: Record<string, string>;
};

export type NativeDiagnosticsSnapshot = {
  stalls: NativeStallRecord[];
  /** MetricKit reports, already reduced natively to an allowlist (no exception messages). */
  reports: Array<{ receivedAt?: string; summary?: Array<Record<string, unknown>>; payload?: unknown }>;
  reportCount?: number;
  /** Every stored pause; the overview lists only the last few. */
  stallCount?: number;
  /** MetricKit's daily energy metrics, averaged over the newest seven days (location v4 step 3). */
  energy?: NativeEnergySummary | null;
  /** Every stored day (snapshot only). */
  energyDays?: NativeEnergyDay[];
};

type AppStateLike = {
  currentState: string;
  addEventListener(type: "change", listener: (state: string) => void): { remove(): void };
};

export const STALL_ANSWER_INTERVAL_MS = 1000;

export function installStallWatchdog(
  native: NativeDiagnostics | null | undefined,
  appState: AppStateLike,
  timers: Pick<typeof globalThis, "setInterval" | "clearInterval"> = globalThis
) {
  if (!native) return () => undefined;
  let interval: ReturnType<typeof setInterval> | null = null;
  const answer = () => {
    try {
      native.jsAnswered();
    } catch {
      // A missing answer only ever over-reports a stall.
    }
  };
  // Answers only in front: no wakeups in the background, where native does not watch either.
  const follow = (state: string) => {
    if (state === "active" && !interval) {
      answer();
      interval = timers.setInterval(answer, STALL_ANSWER_INTERVAL_MS);
    } else if (state !== "active" && interval) {
      timers.clearInterval(interval);
      interval = null;
    }
  };
  setJsTaskSink((running, last) => native.setJsTasks(running, last));
  const subscription = appState.addEventListener("change", follow);
  follow(appState.currentState);
  return () => {
    subscription.remove();
    if (interval) timers.clearInterval(interval);
    interval = null;
    setJsTaskSink(null);
  };
}

/** For Sync help's support details: stalls in full (labels and times only), MetricKit summaries, and
 * the newest few full reports (allowlisted natively: call stacks of binary images and offsets, named
 * metadata, an exception's type and name but never its message). */
export function supportFreezeDiagnostics(snapshot: NativeDiagnosticsSnapshot | null, fullReports = 3) {
  if (!snapshot) return null;
  return {
    stalls: snapshot.stalls.slice(-20),
    reports: snapshot.reports.map((report, index) => ({
      receivedAt: report.receivedAt ?? null,
      summary: report.summary ?? [],
      ...(index < fullReports && report.payload ? { payload: report.payload } : {})
    }))
  };
}

/** One line for Sync help, or null when nothing was recorded. */
export function freezeDiagnosticsSummary(
  snapshot: NativeDiagnosticsSnapshot | null,
  formatTime: (at: Date) => string
) {
  const reportCount = snapshot?.reportCount ?? snapshot?.reports.length ?? 0;
  const stallCount = snapshot?.stallCount ?? snapshot?.stalls.length ?? 0;
  if (!snapshot || (!stallCount && !reportCount)) return null;
  const parts: string[] = [];
  const latest = snapshot.stalls[snapshot.stalls.length - 1];
  if (stallCount && latest) {
    const count = stallCount;
    parts.push(`${count} ${count === 1 ? "pause" : "pauses"}, last ${formatTime(new Date(latest.startedAt))} for ${Math.round(latest.durationMs / 1000)} s`);
  }
  if (reportCount) {
    const count = reportCount;
    parts.push(`${count} system ${count === 1 ? "report" : "reports"}`);
  }
  return parts.join(" · ");
}
