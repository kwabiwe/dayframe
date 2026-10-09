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

  it("never starts a timer or writes time", () => {
    expect(screen).not.toMatch(/startTimer|stopTimer|createTimeEntry|queueEvent|enqueue/);
  });

  it("keeps one owner for step movement and a Reduce Motion fade", () => {
    expect(screen).toContain("entering={reduceMotion ? localPresenceEntering(true) : stepEntering(direction)}");
    expect(screen).toContain("key={`${step}:${answers.locationStage}`}");
  });
});
