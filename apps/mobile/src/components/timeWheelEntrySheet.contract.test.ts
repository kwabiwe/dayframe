import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A11b (owner decisions 12 Oct 2026), date pickers PR 4: the entry sheet's time cards open the
// native time wheel inline; VoiceOver adjusts the cards instead.
const sheet = readFileSync(fileURLToPath(new URL("./ActiveTimerEditSheet.tsx", import.meta.url)), "utf8");
const swift = readFileSync(fileURLToPath(new URL("../../modules/dayframe-time-wheel/ios/DayframeTimeWheelExpoView.swift", import.meta.url)), "utf8");

describe("entry sheet time wheel (A11b)", () => {
  it("opens the wheel from both cards and never types without asking", () => {
    expect(sheet).toContain('onPress={() => openTimeWheel("start")}');
    expect(sheet).toContain('onPress={() => openTimeWheel("end")}');
    expect(sheet).toContain('editable={!busy && typingTarget === "start"}');
    expect(sheet).toContain('editable={!busy && typingTarget === "end"}');
    expect(sheet).not.toContain("onPress={() => timeInputRef.current?.focus()}");
    expect(sheet).toContain('testID="time-entry-time-wheel-type"');
    expect(sheet).toContain('testID="time-entry-time-wheel-every-minute"');
    expect(sheet).toContain('testID="time-entry-time-wheel-done"');
  });

  it("ignores a spin from an older presentation or revision, so it can't undo an outside change", () => {
    expect(sheet).toMatch(/function handleTimeWheelChange[\s\S]*?change\.presentationId !== timeWheel\.presentationId\) return;[\s\S]*?change\.revision !== timeWheelRevisionRef\.current\) return;/);
    // Outside changes bump the revision: the dial (and the previous-end chip through it) and the date sheet.
    expect(sheet).toMatch(/function applyDialInterval[\s\S]*?setTimeWheelRevision\(\(current\) => current \+ 1\);[\s\S]*?function applyCardTime/);
    expect((sheet.match(/setTimeWheelRevision\(\(current\) => current \+ 1\);/g) ?? []).length).toBeGreaterThanOrEqual(5);
    // The wheel's own spins don't: applyCardTime leaves the revision alone.
    expect(sheet).toMatch(/function applyCardTime[\s\S]*?setValidationError\(null\);\n  \}/);
    expect(sheet.match(/function applyCardTime[\s\S]*?\n  \}\n/)?.[0]).not.toContain("setTimeWheelRevision");
    // Native side: only a new presentation or revision moves the columns.
    expect(swift).toContain("if isNewPresentation || previous?.revision != next.revision {");
    expect(swift).not.toContain("|| picker.date != value");
  });

  it("gives VoiceOver adjustable cards with Type time and Change date, never the wheel", () => {
    expect(sheet).toContain('accessibilityRole="adjustable"');
    expect(sheet).toContain('{ name: "typeTime", label: "Type time" }');
    expect(sheet).toContain('{ name: "changeDate", label: "Change date" }');
    expect(sheet).toMatch(/if \(screenReaderEnabled\) \{\s*typeCardTime\(target\);/);
    expect(sheet).toContain("timeWheelAccessibilityStep(cardTimeMs(target), direction, { maximumMs: cardMaximumMs(target) })");
    expect(swift).toContain("picker.accessibilityElementsHidden = true");
  });

  it("keeps the dial in view and in step while the wheel is open", () => {
    expect(sheet).toContain('layoutDensity={timeWheel ? "condensed" : layoutDensity}');
    expect(sheet).toContain("onInteractionStart={() => dismissTransientEditingSurfaces({ keepTimeWheel: true })}");
    expect(sheet).toContain('entering={localPresenceEntering(reduceMotion, "rise")}');
    expect(sheet).toContain("exiting={localPresenceExiting(reduceMotion)}");
    expect(sheet).toContain("onStartShouldSetResponder={() => true}");
  });
});
