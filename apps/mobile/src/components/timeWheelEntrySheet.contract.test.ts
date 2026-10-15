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
    // Ownership and revision live in refs changed in the same tick as the action (Codex r1 on #428).
    expect(sheet).toMatch(/const setTimeWheel = \(next[\s\S]*?timeWheelRef\.current = next;\s*setTimeWheelState\(next\);/);
    expect(sheet).toMatch(/const bumpTimeWheelRevision = \(\) => \{\s*timeWheelRevisionRef\.current \+= 1;/);
    expect(sheet).not.toContain("timeWheelRevisionRef.current = timeWheelRevision;");
    expect(sheet).toMatch(/function handleTimeWheelChange[\s\S]*?const wheel = timeWheelRef\.current;[\s\S]*?change\.presentationId !== wheel\.presentationId\) return;[\s\S]*?change\.revision !== timeWheelRevisionRef\.current\) return;[\s\S]*?mutationGateRef\.current !== null/);
    // Outside changes bump the revision: the dial (and the previous-end chip through it), the date
    // sheet, a VoiceOver step, Every minute's rounding, a retarget and a mutation.
    expect(sheet).toMatch(/function applyDialInterval[\s\S]*?bumpTimeWheelRevision\(\);[\s\S]*?function applyCardTime/);
    expect((sheet.match(/bumpTimeWheelRevision\(\);/g) ?? []).length).toBeGreaterThanOrEqual(7);
    // The wheel's own spins don't: applyCardTime leaves the revision alone.
    expect(sheet.match(/function applyCardTime[\s\S]*?\n  \}\n/)?.[0]).not.toContain("bumpTimeWheelRevision");
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

  it("takes the dial's measured room while open, so the fixed sheet never grows (Codex r1/r2 on #428)", () => {
    expect(sheet).toMatch(/\{timeWheel \? null : \(\s*<View\s*onLayout=\{\(event\) => setDialAreaHeight\(event\.nativeEvent\.layout\.height\)\}/);
    expect(sheet).toContain("dialAreaHeight - TIME_WHEEL_PANEL_CHROME - (timeWheelShowsSummary ? TIME_WHEEL_SUMMARY_HEIGHT : 0)");
    expect(sheet).toContain("const TIME_WHEEL_PANEL_CHROME = 12 + 8 + 4 + 44 + 8;");
    expect(sheet).toContain('testID="time-entry-time-wheel-summary"');
    // The foot stays one 44-point row: labels shrink rather than wrap.
    expect(sheet).toMatch(/timeWheelFoot: \{ alignItems: "center", flexDirection: "row", gap: 6 \}/);
    expect(sheet).toContain('entering={localPresenceEntering(reduceMotion, "rise")}');
    expect(sheet).toContain("exiting={localPresenceExiting(reduceMotion)}");
    expect(sheet).toContain("onStartShouldSetResponder={() => true}");
  });

  it("keeps the wheel honest around typing, saving, Escape and the previous-end chip (Codex r1 on #428)", () => {
    // A half-typed card takes the time the wheel shows before the wheel opens.
    expect(sheet).toContain("if (!cardTextValid(target)) applyCardTime(target, cardTimeMs(target));");
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
