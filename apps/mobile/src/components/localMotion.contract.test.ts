/// <reference types="node" />

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pickerSource = source("./FloatingDatePicker.tsx");
const confirmationSource = source("./DeleteEntryConfirmation.tsx");
const reviewSource = source("../../app/review.tsx");
const placesSource = source("../../app/places.tsx");

describe("local motion ownership contracts", () => {
  it("keeps picker presence and month continuity with the local Reanimated owner", () => {
    expect(pickerSource).toContain("localPresenceEntering");
    expect(pickerSource).toContain("localPresenceExiting");
    expect(pickerSource).toContain("key={formatDateKey(month)}");
    expect(pickerSource).not.toContain("LayoutAnimation.configureNext");
  });

  it("animates only the contained Edit Timer confirmation", () => {
    expect(confirmationSource).toContain('presentation === "contained"');
    expect(confirmationSource).toContain('localPresenceEntering(reduceMotion, "scale")');
    expect(confirmationSource).toContain('animationType={reduceMotion ? "none" : "fade"}');
  });

  it("gives Review and Places one local presence/layout owner after successful state changes", () => {
    for (const screenSource of [reviewSource, placesSource]) {
      expect(screenSource).toContain("applyAfterSuccessfulMutation");
      expect(screenSource).toContain("localLayoutTransition(reduceMotion)");
      expect(screenSource).toContain("localPresenceExiting(reduceMotion)");
    }
  });
});

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}
