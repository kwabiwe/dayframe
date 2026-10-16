import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A11b, date pickers PR 5: the Location evidence editor's Start / End open the same inline time
// wheel as the entry sheet (the shared TimeWheelPanel); VoiceOver adjusts the fields. Simplified by
// the owner on 16 Oct 2026: every minute always, no Type time, no Done.
const editor = readFileSync(fileURLToPath(new URL("./LocationReviewCorrectionEditor.tsx", import.meta.url)), "utf8");

describe("Location evidence time wheel (A11b)", () => {
  it("opens the shared wheel from Start and End; the same field or a tap outside closes it (owner, 16 Oct 2026)", () => {
    expect(editor).toContain('onPress={() => openTimeWheel("start")}');
    expect(editor).toContain('onPress={() => openTimeWheel("end")}');
    expect(editor).toContain("<TimeWheelPanel");
    expect(editor).toContain('testIDPrefix="location-review-time-wheel"');
    expect(editor).toMatch(/function openTimeWheel\(target: "start" \| "end"\) \{\s*if \(saving\) return;\s*const open = timeWheelRef\.current;\s*if \(open\?\.target === target\) \{\s*closeTimeWheel\(\{ haptic: true \}\);\s*return;/);
    // A tap outside closes it only while it is open; a drag is the scroll view's.
    expect(editor).toMatch(/onResponderRelease=\{\(\) => closeTimeWheel\(\{ haptic: true \}\)\}\s*onStartShouldSetResponder=\{\(\) => timeWheelRef\.current !== null\}\s*style=\{styles\.contentStack\}/);
    // Every minute, and no typing path.
    expect(editor).toMatch(/\/\/ Every minute, always \(owner, 16 Oct 2026\)\.\s*minuteInterval: 1,/);
    expect(editor).not.toMatch(/keyboardType="number-pad"|typingTarget|typeFieldTime|toggleEveryMinute|timeWheelStepPref|formatLocationReviewEditableTime/);
  });

  it("writes the times through the same merge as typing, and ignores stale or late spins", () => {
    // The chosen instant while the text shows it, else the text merged as typing is (Codex r1 on #432).
    expect(editor).toMatch(/function fieldInstant[\s\S]*?locationReviewEndpointMs\(\{\s*baselineMs: base\.getTime\(\),\s*draftMs: target === "end" \? stopDraftMs : startDraftMs,/);
    expect((editor.match(/startDraftMs,\n\s*startTimeText,/g) ?? []).length).toBe(2);
    expect(editor).toMatch(/function handleTimeWheelChange[\s\S]*?const wheel = timeWheelRef\.current;[\s\S]*?change\.presentationId !== wheel\.presentationId\) return;[\s\S]*?change\.revision !== timeWheelRevisionRef\.current\) return;[\s\S]*?savingRef\.current/);
    // A save closes the wheel and makes its later spins stale.
    expect(editor).toMatch(/if \(!saving \|\| !timeWheelRef\.current\) return;\s*setTimeWheel\(null\);\s*bumpTimeWheelRevision\(\);/);
  });

  it("gives VoiceOver adjustable fields that open and close the wheel (owner, 16 Oct 2026)", () => {
    expect((editor.match(/accessibilityRole="adjustable"/g) ?? []).length).toBe(2);
    expect(editor).not.toContain('name: "typeTime"');
    expect(editor).toContain('else if (actionName === "activate") openTimeWheel(target);');
    expect((editor.match(/Double-tap to close the time wheel\./g) ?? []).length).toBe(2);
    expect(editor).not.toContain("screenReaderEnabled");
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
