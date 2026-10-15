import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A11b, date pickers PR 5: the Location evidence editor's Start / End open the same inline time
// wheel as the entry sheet (the shared TimeWheelPanel); VoiceOver adjusts the fields instead.
const editor = readFileSync(fileURLToPath(new URL("./LocationReviewCorrectionEditor.tsx", import.meta.url)), "utf8");

describe("Location evidence time wheel (A11b)", () => {
  it("opens the shared wheel from Start and End and types only when asked", () => {
    expect(editor).toContain('onPress={() => openTimeWheel("start")}');
    expect(editor).toContain('onPress={() => openTimeWheel("end")}');
    expect(editor).toContain("<TimeWheelPanel");
    expect(editor).toContain('testIDPrefix="location-review-time-wheel"');
    expect(editor).toContain('editable={!saving && typingTarget === "start"}');
    expect(editor).toContain('editable={!saving && typingTarget === "end"}');
  });

  it("writes the times through the same merge as typing, and ignores stale or late spins", () => {
    // The chosen instant while the text shows it, else the text merged as typing is (Codex r1 on #432).
    expect(editor).toMatch(/function fieldInstant[\s\S]*?locationReviewEndpointMs\(\{\s*baselineMs: base\.getTime\(\),\s*draftMs: target === "end" \? stopDraftMs : startDraftMs,/);
    expect((editor.match(/startDraftMs,\n\s*startTimeText,/g) ?? []).length).toBe(2);
    expect(editor).toMatch(/function handleTimeWheelChange[\s\S]*?const wheel = timeWheelRef\.current;[\s\S]*?change\.presentationId !== wheel\.presentationId\) return;[\s\S]*?change\.revision !== timeWheelRevisionRef\.current\) return;[\s\S]*?savingRef\.current/);
    // A save closes the wheel and makes its later spins stale.
    expect(editor).toMatch(/if \(!saving \|\| !timeWheelRef\.current\) return;\s*setTimeWheel\(null\);\s*bumpTimeWheelRevision\(\);/);
    // A half-typed field takes the time the wheel shows before it opens.
    expect(editor).toContain("if (fieldInstant(target) === null) applyFieldTime(target, fieldTimeMs(target));");
  });

  it("gives VoiceOver adjustable fields with Type time, never the wheel", () => {
    expect((editor.match(/accessibilityRole="adjustable"/g) ?? []).length).toBe(2);
    expect(editor).toContain('{ name: "typeTime", label: "Type time" }');
    expect(editor).toMatch(/if \(screenReaderEnabled\) \{\s*typeFieldTime\(target\);/);
    expect(editor).toContain("timeWheelAccessibilityStep(fieldTimeMs(target), direction)");
  });

  it("closes the wheel when another field takes focus, a place changes, All activities opens or the screen loses focus", () => {
    expect(editor).toMatch(/function supersedePlacePick\(\) \{[\s\S]*?setTimeWheel\(null\);/);
    expect(editor).toMatch(/setTimeWheel\(null\);\s*setActivityPickerOpen\(true\);/);
    expect(editor).toMatch(/if \(isFocused \|\| !timeWheelRef\.current\) return;\s*setTimeWheel\(null\);/);
    expect(editor).toContain("onFocus={() => setTimeWheel(null)}");
    expect(editor).toMatch(/async function chooseNearbyPlace[\s\S]*?setTimeWheel\(null\);\s*const token = \+\+placePickTokenRef\.current;/);
    expect(editor).toMatch(/onFocus=\{\(\) => \{\s*setTimeWheel\(null\);\s*focusRevealControl\(searchInputRef\.current\);/);
    expect(editor).toMatch(/onFocus=\{\(\) => \{\s*setTimeWheel\(null\);\s*focusRevealControl\(activityInputRef\.current\);/);
  });
});
