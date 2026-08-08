import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const moduleRoot = fileURLToPath(new URL("../../modules/dayframe-duration-dial/", import.meta.url));
const componentSource = readFileSync(
  fileURLToPath(new URL("../components/TimeEntryDurationDial.tsx", import.meta.url)),
  "utf8"
);
const expoViewSource = readFileSync(`${moduleRoot}ios/DayframeDurationDialExpoView.swift`, "utf8");
const coreSource = readFileSync(`${moduleRoot}ios/DayframeDurationDialCore.swift`, "utf8");

describe("native duration dial contract", () => {
  it("ships as an Expo local module with a typed model boundary", () => {
    expect(existsSync(`${moduleRoot}expo-module.config.json`)).toBe(true);
    expect(existsSync(`${moduleRoot}ios/DayframeDurationDial.podspec`)).toBe(true);
    expect(expoViewSource).toContain("JSONDecoder().decode(DayframeDurationDialRecord.self");
    expect(expoViewSource).toContain("guard next.modelVersion == 1");
    expect(componentSource).toContain("modelVersion: 1 as const");
  });

  it("keeps direct manipulation native and relative to one gesture snapshot", () => {
    expect(expoViewSource.match(/UIPanGestureRecognizer\(\)/g)).toHaveLength(1);
    expect(expoViewSource).toContain("interactionRecord = record");
    expect(expoViewSource).toContain("accumulatedRadians += delta");
    expect(expoViewSource).toContain("record: interactionRecord");
    expect(expoViewSource).toContain("interactionRecord = nil");
    expect(expoViewSource).toContain("deltaMinutes: accepted");
    expect(expoViewSource).toContain('phase: "cancelled"');
    expect(componentSource).toContain("snapshotsRef.current.get(interaction.interactionId)");
    expect(componentSource).toContain("onChange(snapshot)");
  });

  it("coordinates the native dial against the sheet pan without JS-frame dragging", () => {
    expect(componentSource).toContain("Gesture.Native().disallowInterruption(true)");
    expect(componentSource).toContain("<GestureDetector gesture={nativeDialGesture}>");
    expect(expoViewSource).toContain("disableAncestorScrolling()");
    expect(expoViewSource).not.toMatch(/URLSession|fetch\(|axios|WebSocket/);
  });

  it("supports multi-turn minutes, centred stacked handles, and graduated haptics", () => {
    expect(coreSource).toContain("radians / fullTurn * 60");
    expect(expoViewSource).toContain("handle == .range ? baseRadius + 34 : baseRadius");
    expect(expoViewSource).toContain("drawHandle(.end, record: record)");
    expect(expoViewSource).toContain("drawHandle(.start, record: record)");
    expect(expoViewSource).toContain("bringSubviewToFront(startButton)");
    expect(expoViewSource).toContain("baseRadius + 34");
    expect(expoViewSource).toContain("duration >= 3_600_000");
    expect(expoViewSource).toContain("UISelectionFeedbackGenerator");
    expect(expoViewSource).toContain("UIImpactFeedbackGenerator(style: .light)");
    expect(expoViewSource).toContain("UIImpactFeedbackGenerator(style: .heavy)");
  });
});
