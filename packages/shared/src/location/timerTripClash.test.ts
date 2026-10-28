import { describe, expect, it } from "vitest";
import { timerTripClash, timerTripClashStillAsks, timerTripClashTitle, type TimerTripClashEntry } from "./timerTripClash";

const at = (time: string) => `2026-10-28T${time}:00.000Z`;
const block = (startedAt: string, stoppedAt: string | null, extra: Partial<TimerTripClashEntry> = {}): TimerTripClashEntry => ({
  id: "entry-1", startedAt: at(startedAt), stoppedAt: stoppedAt ? at(stoppedAt) : null, source: "manual_app", eventType: "timer_start", ...extra
});
const trip = (id: string, startedAt: string, stoppedAt: string) => ({ id, startedAt: at(startedAt), stoppedAt: at(stoppedAt) });
const now = Date.parse(at("18:00"));

describe("timerTripClash (location v4 design §7)", () => {
  it("asks when a block already running ran more than 5 minutes into a trip", () => {
    expect(timerTripClash(block("13:00", "14:40"), [trip("t1", "14:22", "14:50")], now)).toEqual({
      timeEntryId: "entry-1", tripId: "t1", tripStartedAt: at("14:22"), tripStoppedAt: at("14:50"), overlapSeconds: 18 * 60
    });
  });

  it("counts a running timer up to the trip's end", () => {
    expect(timerTripClash(block("13:00", null), [trip("t1", "14:22", "14:50")], now)?.overlapSeconds).toBe(28 * 60);
  });

  it("asks nothing within the 5-minute tolerance, for a block started as you left, or one started on the way", () => {
    expect(timerTripClash(block("13:00", "14:27"), [trip("t1", "14:22", "14:50")], now)).toBeNull();
    expect(timerTripClash(block("14:18", "14:40"), [trip("t1", "14:22", "14:50")], now)).toBeNull();
    expect(timerTripClash(block("14:30", "15:00"), [trip("t1", "14:22", "14:50")], now)).toBeNull();
  });

  it("asks about the first trip the block ran into", () => {
    expect(timerTripClash(block("09:00", null), [trip("late", "17:00", "17:30"), trip("early", "12:00", "12:20")], now)?.tripId).toBe("early");
    // The first trip it only touched within tolerance is skipped for the next one it really ran into.
    expect(timerTripClash(block("11:00", null), [trip("brief", "12:00", "12:04"), trip("next", "13:00", "13:30")], now)?.tripId).toBe("next");
  });

  it("never asks for Health, location blocks, unconfirmed blocks or move activities", () => {
    const trips = [trip("t1", "14:22", "14:50")];
    expect(timerTripClash(block("13:00", "15:00", { source: "health_workout", eventType: "health_workout_import" }), trips, now)).toBeNull();
    expect(timerTripClash(block("13:00", "15:00", { source: "location_learning", eventType: "geofence_exit" }), trips, now)).toBeNull();
    expect(timerTripClash(block("13:00", "15:00", { source: "location_learning", eventType: "commute_detected" }), trips, now)).toBeNull();
    expect(timerTripClash(block("13:00", "15:00", { reviewStatus: "needs_review" }), trips, now)).toBeNull();
    for (const key of ["commute", "travel", "errands"]) {
      expect(timerTripClash(block("13:00", "15:00", { categoryStarterKey: key }), trips, now)).toBeNull();
    }
    expect(timerTripClash(block("13:00", "15:00", { categoryStarterKey: "work" }), trips, now)).not.toBeNull();
    // A block added by hand, or one whose end you set yourself: you chose where it ends.
    expect(timerTripClash(block("13:00", "15:00", { timerEnd: false }), trips, now)).toBeNull();
    expect(timerTripClash(block("13:00", null, { timerEnd: true }), trips, now)).not.toBeNull();
  });
});

describe("timerTripClashStillAsks", () => {
  const question = { tripId: "t1", tripStartedAt: at("14:22"), tripStoppedAt: at("14:50") };
  it("stops asking once the block ends at the trip, is deleted, or becomes a move activity", () => {
    expect(timerTripClashStillAsks(question, block("13:00", "14:40"), now)).toBe(true);
    expect(timerTripClashStillAsks(question, block("13:00", "14:22"), now)).toBe(false);
    expect(timerTripClashStillAsks(question, null, now)).toBe(false);
    expect(timerTripClashStillAsks(question, block("13:00", "14:40", { categoryStarterKey: "commute" }), now)).toBe(false);
  });
});

describe("timerTripClashTitle", () => {
  it("names the block and how far it ran", () => {
    expect(timerTripClashTitle("Team sync", 18 * 60)).toBe("Team sync ran 18m into your trip");
    expect(timerTripClashTitle("  ", 65 * 60)).toBe("This block ran 1h 5m into your trip");
    expect(timerTripClashTitle(null, 120 * 60)).toBe("This block ran 2h into your trip");
  });
});
