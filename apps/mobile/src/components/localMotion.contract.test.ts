/// <reference types="node" />

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The entry sheet's date sheet (14 Oct 2026) is the shared DateSheet in the swipe-dismiss shell.
const pickerSource = source("./DateSheet.tsx");
const shellSource = source("./sheets/BottomSheetShell.tsx");
const calendarSource = source("./calendar/DatePickerCalendar.tsx");
const placesSource = source("../../app/places.tsx");

describe("local motion ownership contracts", () => {
  it("keeps picker presence and month continuity with the local Reanimated owner", () => {
    expect(pickerSource).toContain("<BottomSheetShell");
    expect(shellSource).toContain("<SwipeDismissSheet");
    expect(pickerSource).toContain("<DatePickerCalendar");
    expect(calendarSource).toContain("key={visibleMonth}");
    expect(calendarSource).toContain("height: 264");
    expect(calendarSource).toContain("withTiming(1");
    expect(calendarSource).toContain("accessibilityElementsHidden={outgoing}");
    expect(calendarSource).toContain('pointerEvents={outgoing ? "none" : "auto"}');
    expect(calendarSource).not.toContain("LayoutAnimation.configureNext");
    expect(pickerSource).not.toContain("LayoutAnimation.configureNext");
  });

  it("gives Places one local presence/layout owner around mutations", () => {
    expect(placesSource).toContain("applyAfterSuccessfulMutation");
    expect(placesSource).toContain("localLayoutTransition(reduceMotion)");
    expect(placesSource).toContain("localPresenceExiting(reduceMotion)");
  });
});

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}
