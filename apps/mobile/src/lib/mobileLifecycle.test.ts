import { describe, expect, it } from "vitest";
import {
  CALENDAR_FOREGROUND_RESET_AFTER_MS,
  shouldDismissExternallyStoppedActiveEditor,
  shouldResetCalendarToTodayOnForeground
} from "./mobileLifecycle";

describe("mobile foreground lifecycle", () => {
  it("returns a stale calendar selection to today after fifteen minutes", () => {
    expect(shouldResetCalendarToTodayOnForeground({
      backgroundedAt: 1_000,
      backgroundedDayKey: "2026-08-12",
      resumedAt: 1_000 + CALENDAR_FOREGROUND_RESET_AFTER_MS,
      selectedDayKey: "2026-08-08",
      todayKey: "2026-08-12"
    })).toBe(true);
  });

  it("keeps a deliberate past-day selection across a short interruption", () => {
    expect(shouldResetCalendarToTodayOnForeground({
      backgroundedAt: 1_000,
      backgroundedDayKey: "2026-08-12",
      resumedAt: 1_000 + 60_000,
      selectedDayKey: "2026-08-08",
      todayKey: "2026-08-12"
    })).toBe(false);
  });

  it("returns to today across a calendar-day rollover", () => {
    expect(shouldResetCalendarToTodayOnForeground({
      backgroundedAt: 1_000,
      backgroundedDayKey: "2026-08-12",
      resumedAt: 2_000,
      selectedDayKey: "2026-08-08",
      todayKey: "2026-08-13"
    })).toBe(true);
  });

  it("dismisses only an externally-stopped active editor", () => {
    expect(shouldDismissExternallyStoppedActiveEditor({
      activeEntryId: null,
      presentationId: 4,
      presentedEntryId: "entry-1",
      timerMutationsInFlight: 0
    })).toBe(true);
    expect(shouldDismissExternallyStoppedActiveEditor({
      activeEntryId: null,
      presentationId: 4,
      presentedEntryId: "entry-1",
      timerMutationsInFlight: 1
    })).toBe(false);
    expect(shouldDismissExternallyStoppedActiveEditor({
      activeEntryId: "entry-1",
      presentationId: 4,
      presentedEntryId: "entry-1",
      timerMutationsInFlight: 0
    })).toBe(false);
  });
});
