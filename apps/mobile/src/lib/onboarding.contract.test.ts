/// <reference types="node" />

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const screen = read("../../app/onboarding.tsx");
const layout = read("../../app/_layout.tsx");
const settings = read("../../app/settings.tsx");
const dashboard = read("../components/DayframeDashboard.tsx");

describe("onboarding contract (Blocks 8-1a)", () => {
  it("is only reached from Settings for now (the first-sign-in gate comes with the last step)", () => {
    expect(settings).toContain('router.push("/onboarding")');
    expect(dashboard).not.toContain("/onboarding");
  });

  it("can't be swiped away half-way through a permission", () => {
    expect(layout).toMatch(/name="onboarding"[\s\S]{0,160}gestureEnabled: false/);
  });

  it("asks iOS for While Using first, then explains before asking for Always", () => {
    const foreground = screen.indexOf("requestForegroundPermissionsAsync");
    const background = screen.indexOf("requestBackgroundPermissionsAsync");
    expect(foreground).toBeGreaterThan(-1);
    expect(background).toBeGreaterThan(foreground);
    expect(screen).toContain("One more step for drives");
  });

  it("switches on suggestions only after Always, the same way Settings does", () => {
    expect(screen).toMatch(/async function finishAlways[\s\S]*ensureAutomaticLoggingCategories\(\["commute"\]\)[\s\S]*setLocationLearningEnabled\(true/);
  });

  it("decides suggestions from the account's own consent, and offers it when Always was already allowed", () => {
    expect(screen).toContain('enabled = suggestionsStateFrom(await getLocationVisitDiagnostics()) === "on";');
    expect(screen).toContain("suggestions: diagnostics ? suggestionsStateFrom(diagnostics)");
    expect(screen).toContain('testID="onboarding-suggestions-on"');
  });

  it("opens Today at the end, starts each step at its top with VoiceOver on its heading", () => {
    expect(screen).toContain('router.dismissTo("/(tabs)/today")');
    expect(screen).toContain("key={step} style={styles.body}");
    expect(screen).toContain("AccessibilityInfo.setAccessibilityFocus(handle)");
  });

  it("fences late answers by session, not only by account", () => {
    expect(screen).toContain("subscribeAuthenticatedSession(bump)");
    expect(screen).toContain("subscribeMobileSignedOut(bump)");
    // Covered by another page: a pending answer no longer applies.
    expect(screen).toMatch(/useFocusEffect\(useCallback\(\(\) => \(\) => \{\n    sessionEpoch.current \+= 1;/);
  });

  it("never starts a timer or writes time", () => {
    expect(screen).not.toMatch(/startTimer|stopTimer|createTimeEntry|queueEvent|enqueue/);
  });

  it("keeps one owner for step movement and a Reduce Motion fade", () => {
    expect(screen).toContain("entering={reduceMotion ? localPresenceEntering(true) : stepEntering(direction)}");
    expect(screen).toContain("key={`${step}:${answers.locationStage}`}");
  });
});
