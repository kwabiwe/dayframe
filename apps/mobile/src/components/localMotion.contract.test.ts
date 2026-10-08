/// <reference types="node" />

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pickerSource = source("./FloatingDatePicker.tsx");
const calendarSource = source("./calendar/DatePickerCalendar.tsx");
const reviewSource = source("../../app/review.tsx");
const placesSource = source("../../app/places.tsx");

describe("local motion ownership contracts", () => {
  it("keeps picker presence and month continuity with the local Reanimated owner", () => {
    expect(pickerSource).toContain("localPresenceEntering");
    expect(pickerSource).toContain("localPresenceExiting");
    expect(pickerSource).toContain("<DatePickerCalendar");
    expect(calendarSource).toContain("key={visibleMonth}");
    expect(calendarSource).toContain("height: 264");
    expect(calendarSource).toContain("withTiming(1");
    expect(calendarSource).toContain("accessibilityElementsHidden={outgoing}");
    expect(calendarSource).toContain('pointerEvents={outgoing ? "none" : "auto"}');
    expect(calendarSource).not.toContain("LayoutAnimation.configureNext");
    expect(pickerSource).not.toContain("LayoutAnimation.configureNext");
  });

  it("gives Review and Places one local presence/layout owner around mutations", () => {
    expect(reviewSource).toContain("enqueueReviewMutation");
    expect(placesSource).toContain("applyAfterSuccessfulMutation");
    expect(placesSource).toContain("localLayoutTransition(reduceMotion)");
    expect(placesSource).toContain("localPresenceExiting(reduceMotion)");
    // The Review deck (Blocks step 5a): each card owns its depth spring and its presence.
    const deckSource = source("./review/ReviewDeck.tsx");
    expect(reviewSource).toContain("<ReviewDeckStack");
    expect(deckSource).toContain("localPresenceExiting(reduceMotion)");
    expect(deckSource).toContain("withSpring(depth, { ...BLOCKS_SPRING.land");
  });
});

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}
