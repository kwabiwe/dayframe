import { useEffect, useMemo, useRef } from "react";
import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { blockColorsFor, paletteColorFor } from "@dayframe/shared";

type WatchTimerCommand =
  | { requestId: string; action: "start" }
  | { requestId: string; action: "stop"; entryId: string; stoppedAt?: string };

const watchBridge = Platform.OS === "ios" ? NativeModules.DayframeWatchBridge : undefined;

/** The Watch draws on a dark face, so it always takes the Midnight display colours. */
const WATCH_MODE = "dark" as const;
/** Today's strip on the Watch holds at most this many activity segments (as Today's "Where today went"). */
export const WATCH_SEGMENT_LIMIT = 4;
/** A segment with no activity colour (no activity, or the grouped Other) is drawn in the neutral grey. */
export const WATCH_NEUTRAL_FILL = "#9AA2B4";

export type WatchDisplayInput = {
  activeEntry: {
    categoryName?: string | null;
    categoryColor?: string | null;
    categoryId?: string | null;
    description: string | null;
  } | null;
  segments: readonly { name: string; color: string | null; seconds: number }[];
  totalSeconds: number;
  goalMinutes: number | null | undefined;
};

/**
 * What the Watch shows around the timer: the running activity's name and colours, the block's
 * description, and today's covered time. Presentation only: it never carries the timer revision, so
 * a change here can never invalidate a Start or Stop the Watch has already sent.
 */
export type WatchDisplay = {
  activityName: string | null;
  activityFill: string | null;
  activityText: string | null;
  title: string | null;
  todaySeconds: number;
  goalSeconds: number | null;
  segments: { fill: string; seconds: number }[];
};

export function buildWatchDisplay(input: WatchDisplayInput): WatchDisplay {
  const entry = input.activeEntry;
  const activityName = entry?.categoryName?.trim() ? entry.categoryName.trim() : null;
  const colors = entry && activityName
    ? blockColorsFor(entry.categoryColor ?? entry.categoryId ?? null, WATCH_MODE, activityName)
    : null;
  const title = entry?.description?.trim() ? entry.description.trim() : null;
  // Whole minutes, like Today's strip, so the Watch hears about the day at most once a minute.
  const segments = input.segments.slice(0, WATCH_SEGMENT_LIMIT).map((segment) => ({
    fill: segment.color ? paletteColorFor(segment.color, segment.name, WATCH_MODE) : WATCH_NEUTRAL_FILL,
    seconds: Math.floor(segment.seconds / 60) * 60,
  }));
  const goalMinutes = input.goalMinutes ?? 0;
  return {
    activityName,
    activityFill: colors?.fill ?? null,
    activityText: colors?.text ?? null,
    title,
    todaySeconds: Math.floor(input.totalSeconds / 60) * 60,
    goalSeconds: goalMinutes > 0 ? goalMinutes * 60 : null,
    segments,
  };
}

/**
 * When a Stop takes effect. Now, unless the Watch queued it while the iPhone was out of reach: then the
 * moment it was pressed, kept inside the block (never before its start, never in the future).
 */
export function watchStopTime(startedAt: string, requested: string | undefined, now: number): string {
  const at = requested ? Date.parse(requested) : Number.NaN;
  if (!Number.isFinite(at)) return new Date(now).toISOString();
  const start = Date.parse(startedAt);
  const floor = Number.isFinite(start) ? start : Number.NEGATIVE_INFINITY;
  return new Date(Math.min(now, Math.max(floor, at))).toISOString();
}

export function useWatchTimer(
  ownerKey: string | null,
  entryId: string | null,
  startedAt: string | null,
  apply: (command: WatchTimerCommand) => Promise<boolean>,
  display: WatchDisplay | null = null
) {
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (!watchBridge) return;
    const events = new NativeEventEmitter(watchBridge);
    const subscription = events.addListener("dayframeWatchTimerCommand", (command: WatchTimerCommand) => {
      void applyRef.current(command).then(
        (accepted) => watchBridge.completeTimerCommand(command.requestId, accepted),
        () => watchBridge.completeTimerCommand(command.requestId, false)
      );
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    watchBridge?.updateTimerSnapshot(ownerKey, entryId, startedAt);
  }, [ownerKey, entryId, startedAt]);

  // One bridge call per real change: the model is rebuilt on renders, its content only on the minute.
  // The owner is part of the key: an account change clears the Watch's display natively, so the next
  // account's display is always sent again, even when it happens to read the same.
  const displayKey = useMemo(() => (ownerKey && display ? JSON.stringify([ownerKey, display]) : null), [ownerKey, display]);
  useEffect(() => {
    if (!watchBridge?.updateTimerDisplay) return;
    watchBridge.updateTimerDisplay(displayKey ? (JSON.parse(displayKey) as [string, WatchDisplay])[1] : null);
  }, [displayKey]);
}
