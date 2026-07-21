/// <reference types="node" />

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  "utf8"
);

const placesSource = readSource("../../app/places.tsx");
const editorSource = readSource("../../app/place-editor.tsx");
const layoutSource = readSource("../../app/_layout.tsx");
const settingsSource = readSource("../../app/settings.tsx");
const timerSheetSource = readSource("../components/ActiveTimerEditSheet.tsx");
const themeSource = readSource("./mobileTheme.ts");

describe("mobile place editor contract", () => {
  it("keeps the Places route list-only and passes stable editor identifiers", () => {
    expect(placesSource).not.toContain("<TextInput");
    expect(placesSource).not.toContain("createPlace(");
    expect(placesSource).not.toContain("updatePlace(");
    expect(placesSource).toContain('pathname: "/place-editor"');
    expect(placesSource).toContain('params: { mode: "edit", placeId: place.id }');
    expect(placesSource).toContain('params: { mode: "learned", learnedPlaceId: learnedPlace.id }');
    expect(layoutSource).toContain('<Stack.Screen name="place-editor"');
  });

  it("keeps search, coordinates and names as separate editor state", () => {
    expect(editorSource).toContain('Address or place');
    expect(editorSource).toContain('Name in Dayframe');
    expect(editorSource).toContain('Advanced coordinates');
    expect(editorSource).not.toContain("Address / Coordinates");
    expect(editorSource).toContain("nameTouched.current");
    expect(editorSource).toContain("resolvedPlaceSelectionDraft(");
    expect(editorSource).toContain("canonicalPlaceCoordinateText(latitude, longitude)");
    expect(editorSource).toContain("controller.dispose()");
    expect(editorSource).toContain("setAdvancedExpanded((expanded) => !expanded)");
    expect(editorSource).not.toMatch(/setAdvancedExpanded[\s\S]{0,160}setLatitudeText/);
    expect(editorSource).not.toContain("console.");
  });

  it("preserves review-first visit preferences and native-unavailable controls", () => {
    expect(editorSource).toContain("Suggest visits here");
    expect(editorSource).toContain("Show detected visits in Review.");
    expect(editorSource).toContain("Place search is unavailable in this build");
    expect(editorSource).toContain("Current location");
    expect(editorSource).toContain("Advanced coordinates");
  });
});

describe("compact location settings contract", () => {
  it("hides internal rollout details from ordinary rendered copy", () => {
    expect(settingsSource).toContain("Location suggestions");
    expect(settingsSource).toContain("Privacy & troubleshooting");
    expect(settingsSource).toContain("Share diagnostics");
    expect(settingsSource).not.toContain(">Engine rollout<");
    expect(settingsSource).not.toContain(">V2 shadow<");
    expect(settingsSource).not.toContain(">Copy diagnostics<");
  });

  it("resets and clamps one section-keyed settings scroll owner", () => {
    expect(settingsSource).toContain("key={settingsSection}");
    expect(settingsSource).toContain('settingsScrollRef.current?.scrollTo({ y: 0, animated: false })');
    expect(settingsSource).toContain("settingsScrollNeedsClamp");
    expect(settingsSource).toContain('settingsSection === "categories"');
  });
});

describe("active timer category scroll contract", () => {
  it("keeps a single horizontal row inside a fixed viewport", () => {
    expect(timerSheetSource).toContain("activeEditCategoryViewport");
    expect(timerSheetSource).toContain("alwaysBounceVertical={false}");
    expect(timerSheetSource).toContain("directionalLockEnabled");
    expect(timerSheetSource).toContain("nestedScrollEnabled");
    expect(timerSheetSource).toContain("showsVerticalScrollIndicator={false}");
    expect(themeSource).toContain("activeEditCategoryViewport: {");
    expect(themeSource).toContain("height: 48");
    expect(themeSource).toContain("minHeight: 44");
  });
});
