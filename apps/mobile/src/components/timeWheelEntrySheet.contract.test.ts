import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A11b (owner decisions 12 Oct 2026), date pickers PR 4: the entry sheet's time cards open the
// native time wheel inline; VoiceOver adjusts the cards. Simplified by the owner on 16 Oct 2026
// (TF122 staging test): every minute always, no Type time, no Done.
const sheet = readFileSync(fileURLToPath(new URL("./ActiveTimerEditSheet.tsx", import.meta.url)), "utf8");
const panel = readFileSync(fileURLToPath(new URL("./TimeWheelPanel.tsx", import.meta.url)), "utf8");
const swift = readFileSync(fileURLToPath(new URL("../../modules/dayframe-time-wheel/ios/DayframeTimeWheelExpoView.swift", import.meta.url)), "utf8");

describe("entry sheet time wheel (A11b)", () => {
  it("opens the wheel from both cards; the same card closes it, the other retargets it (owner, 16 Oct 2026)", () => {
    expect(sheet).toContain('onPress={() => openTimeWheel("start")}');
    expect(sheet).toContain('onPress={() => openTimeWheel("end")}');
    expect(sheet).toMatch(/function openTimeWheel\(target: "start" \| "end"\) \{\s*if \(busy\) return;\s*const open = timeWheelRef\.current;\s*if \(open\?\.target === target\) \{\s*closeTimeWheel\(\{ haptic: true \}\);\s*return;\s*\}\s*if \(open\) \{\s*\/\/[^\n]*\n\s*setTimeWheel\(\{ presentationId: open\.presentationId, target \}\);/);
    // A tap outside the cards and the wheel closes it too.
    expect(sheet).toMatch(/function handleFormBackgroundPress\(\) \{[\s\S]*?closeTimeWheel\(\{ haptic: true \}\);/);
    // The card shows its time as text: no number pad, no typing path.
    expect(sheet).not.toContain('keyboardType="number-pad"');
    expect(sheet).not.toMatch(/typingTarget|typeCardTime|timeInputRef|formatEditableTime/);
    expect(sheet).toContain('testID="time-entry-start-time"');
    expect(sheet).toContain('testID="time-entry-end-time"');
    // The shared panel has no controls of its own: no Every minute, Type time or Done.
    expect(sheet).toContain('testIDPrefix="time-entry-time-wheel"');
    expect(panel).not.toMatch(/every-minute|-type`|-done`|onDone|onTypeTime|onToggleEveryMinute/);
    expect(panel).not.toContain("<Pressable");
  });

  it("always shows every minute: no 5-minute rows and no rounding (owner, 16 Oct 2026)", () => {
    expect(sheet).toMatch(/\/\/ Every minute, always \(owner, 16 Oct 2026\)\.\s*minuteInterval: 1 as const,/);
    expect(sheet).not.toMatch(/timeWheelStepPref|timeWheelMinuteInterval|toggleEveryMinute/);
  });

  it("ignores a spin from an older presentation or revision, so it can't undo an outside change", () => {
    // Ownership and revision live in refs changed in the same tick as the action (Codex r1 on #428).
    expect(sheet).toMatch(/const setTimeWheel = \(next[\s\S]*?timeWheelRef\.current = next;\s*setTimeWheelState\(next\);/);
    expect(sheet).toMatch(/const bumpTimeWheelRevision = \(\) => \{\s*timeWheelRevisionRef\.current \+= 1;/);
    expect(sheet).not.toContain("timeWheelRevisionRef.current = timeWheelRevision;");
    expect(sheet).toMatch(/function handleTimeWheelChange[\s\S]*?const wheel = timeWheelRef\.current;[\s\S]*?change\.presentationId !== wheel\.presentationId\) return;[\s\S]*?change\.revision !== timeWheelRevisionRef\.current\) return;[\s\S]*?mutationGateRef\.current !== null/);
    // Outside changes bump the revision: the dial (and the previous-end chip through it), the date
    // sheet, a VoiceOver step, a retarget and a mutation.
    expect(sheet).toMatch(/function applyDialInterval[\s\S]*?bumpTimeWheelRevision\(\);[\s\S]*?function applyCardTime/);
    expect((sheet.match(/bumpTimeWheelRevision\(\);/g) ?? []).length).toBeGreaterThanOrEqual(6);
    // The wheel's own spins don't: applyCardTime leaves the revision alone.
    expect(sheet.match(/function applyCardTime[\s\S]*?\n  \}\n/)?.[0]).not.toContain("bumpTimeWheelRevision");
    // Native side: only a new presentation or revision moves the columns.
    expect(swift).toContain("if isNewPresentation || previous?.revision != next.revision {");
    expect(swift).not.toContain("|| picker.date != value");
  });

  it("gives VoiceOver adjustable cards that open and close the wheel, with Change date (owner, 16 Oct 2026)", () => {
    expect((sheet.match(/accessibilityRole="adjustable"/g) ?? []).length).toBe(2);
    expect(sheet).toContain('{ name: "changeDate", label: "Change date" }');
    expect(sheet).not.toContain('name: "typeTime"');
    // Activating the card opens the wheel, or closes it when it is this card's; the hint says which.
    expect(sheet).toContain('else if (actionName === "activate") openTimeWheel(target);');
    expect(sheet).toContain('"Swipe up or down to adjust by 5 minutes. Double-tap to close the time wheel."');
    expect(sheet).toContain('"Swipe up or down to adjust by 5 minutes. Double-tap to open the time wheel."');
    expect(sheet).toContain("expanded: timeWheel?.target === \"start\"");
    expect(sheet).not.toContain("screenReaderEnabled");
    expect(sheet).toContain("timeWheelAccessibilityStep(cardTimeMs(target), direction, { maximumMs: cardMaximumMs(target) })");
    expect(swift).toContain("picker.accessibilityElementsHidden = true");
  });

  it("takes the dial's measured room while open, so the fixed sheet never grows (Codex r1/r2 on #428)", () => {
    expect(sheet).toMatch(/\{timeWheel \? null : \(\s*<View\s*onLayout=\{\(event\) => setDialAreaMeasure\(\{ height: event\.nativeEvent\.layout\.height, key: dialAreaKey \}\)\}/);
    // A measurement taken at another density, text size or width is not used (Codex r3 on #428).
    expect(sheet).toContain("const dialAreaHeight = dialAreaMeasure?.key === dialAreaKey ? dialAreaMeasure.height : null;");
    expect(sheet).toContain("const dialAreaKey = `${layoutDensity}:${windowDimensions.fontScale}:${windowDimensions.width}`;");
    expect(sheet).toContain("dialAreaHeight - TIME_WHEEL_PANEL_CHROME - (timeWheelShowsSummary ? TIME_WHEEL_SUMMARY_HEIGHT : 0)");
    // No foot any more: only the margin and the padding around the wheel (owner, 16 Oct 2026).
    expect(panel).toContain("export const TIME_WHEEL_PANEL_CHROME = 12 + 8 + 8;");
    expect(panel).toContain("testID={`${testIDPrefix}-summary`}");
    expect(panel).not.toContain("foot:");
    // Without a foot the panel would be shorter than the dial: it takes the dial's whole room, so the
    // actions below never move while it is open (owner, 16 Oct 2026; Simulator-checked).
    expect(sheet).toContain("minHeight={dialAreaHeight === null ? null : dialAreaHeight - TIME_WHEEL_PANEL_MARGIN_TOP}");
    expect(panel).toContain("export const TIME_WHEEL_PANEL_MARGIN_TOP = 12;");
    expect(panel).toMatch(/panel: \{[^}]*justifyContent: "center"/);
    expect(panel).toContain('entering={localPresenceEntering(reduceMotion, "rise")}');
    expect(panel).toContain("exiting={localPresenceExiting(reduceMotion)}");
    expect(panel).toContain("onStartShouldSetResponder={() => true}");
  });

  it("keeps the wheel honest around saving, Escape and the previous-end chip (Codex r1 on #428)", () => {
    // No "same as the card" skip: a spin back in the same batch must still win (Codex r2 on #428).
    expect(sheet).not.toContain("change.valueMs === cardTimeMs(");
    // A save, stop or delete closes the wheel and makes its later spins stale.
    expect(sheet).toMatch(/mutationGateRef\.current = \{ presentationId: presentation\.id, token \};\s*\/\/[^\n]*\n\s*setTimeWheel\(null\);\s*bumpTimeWheelRevision\(\);/);
    // Escape closes only the wheel.
    expect(sheet).toMatch(/function handleUserRequestClose\(\) \{[\s\S]*?if \(timeWheelRef\.current\) \{\s*closeTimeWheel\(\{ haptic: true \}\);\s*return;/);
    // The chip re-aims an open wheel instead of closing it.
    expect(sheet).toMatch(/function togglePreviousEnd[\s\S]*?dismissTransientEditingSurfaces\(\{ keepTimeWheel: true \}\);\s*applyDialInterval/);
  });
});
