import { describe, expect, it } from "vitest";
import {
  EMPTY_ONBOARDING_ANSWERS,
  ONBOARDING_PROGRESS,
  ONBOARDING_STEPS,
  locationChoiceFromPermissions,
  locationResultText,
  motionResultText,
  nextOnboardingStep,
  onboardingChrome,
  onboardingProgressDone,
  onboardingSummary,
  previousOnboardingStep,
  healthResultText,
  remindersResultText,
  suggestionsStateFrom
} from "./onboarding";

describe("onboarding steps", () => {
  it("walks welcome → location → motion → health → reminders → done and back, never past either end", () => {
    expect(ONBOARDING_STEPS).toEqual(["welcome", "location", "motion", "health", "reminders", "done"]);
    expect(nextOnboardingStep("welcome")).toBe("location");
    expect(nextOnboardingStep("motion")).toBe("health");
    expect(nextOnboardingStep("reminders")).toBe("done");
    expect(nextOnboardingStep("done")).toBe("done");
    expect(previousOnboardingStep("location")).toBe("welcome");
    expect(previousOnboardingStep("welcome")).toBe("welcome");
  });

  it("fills one progress block per finished permission step, in the logo's colours", () => {
    expect(ONBOARDING_PROGRESS.map((item) => item.color)).toEqual(["red", "amber", "lime", "blue"]);
    expect(onboardingProgressDone("welcome")).toBe(0);
    expect(onboardingProgressDone("location")).toBe(0);
    expect(onboardingProgressDone("motion")).toBe(1);
    expect(onboardingProgressDone("reminders")).toBe(3);
    expect(onboardingProgressDone("done")).toBe(4);
  });

  it("shows Back and Later only on the permission steps", () => {
    expect(onboardingChrome("welcome")).toEqual({ back: false, later: false });
    expect(onboardingChrome("location")).toEqual({ back: true, later: true });
    expect(onboardingChrome("done")).toEqual({ back: false, later: false });
  });
});

describe("onboarding answers", () => {
  it("reads iOS location permission as Always, While Using or not yet", () => {
    expect(locationChoiceFromPermissions(true, true)).toBe("always");
    expect(locationChoiceFromPermissions(true, false)).toBe("while");
    expect(locationChoiceFromPermissions(false, false)).toBeNull();
  });

  it("says plainly that suggestions need Always, and that everything else still works without location", () => {
    expect(locationResultText("while")).toMatch(/need Always/);
    expect(locationResultText("off")).toMatch(/Timers, Review and Apple Health still work/);
    expect(motionResultText("unavailable")).toMatch(/doesn't record motion/);
  });

  it("summarises On, Later, and nothing to do when this iPhone has no motion chip", () => {
    const rows = onboardingSummary({ ...EMPTY_ONBOARDING_ANSWERS, location: "while", motion: "unavailable" });
    expect(rows.slice(0, 2)).toEqual([
      expect.objectContaining({ key: "location", state: "later", detail: "Suggestions need Always" }),
      expect.objectContaining({ key: "motion", state: "none", detail: "Not available on this iPhone" })
    ]);
    expect(onboardingSummary({ ...EMPTY_ONBOARDING_ANSWERS, location: "always", suggestions: "on", motion: "on", health: "on", reminders: "on" }).map((row) => row.state))
      .toEqual(["on", "on", "on", "on"]);
  });

  it("keeps Always permission apart from this account's suggestions (Codex r1)", () => {
    expect(locationResultText("always", "off")).toMatch(/Turn on suggestions/);
    expect(locationResultText("always", "failed")).toMatch(/couldn't be switched on/);
    const [notOptedIn] = onboardingSummary({ ...EMPTY_ONBOARDING_ANSWERS, location: "always", suggestions: "off" });
    expect(notOptedIn).toMatchObject({ state: "later", detail: "Suggestions are off" });
    const [failed] = onboardingSummary({ ...EMPTY_ONBOARDING_ANSWERS, location: "always", suggestions: "failed" });
    expect(failed).toMatchObject({ state: "later", detail: "Suggestions couldn't be switched on" });
  });

  it("calls suggestions on only while capture runs; saved consent with capture stopped is paused (Codex r2)", () => {
    expect(suggestionsStateFrom({ locationLearningEnabled: true, locationLearningCaptureState: "active" })).toBe("on");
    expect(suggestionsStateFrom({ locationLearningEnabled: true, locationLearningCaptureState: "inactive" })).toBe("paused");
    expect(suggestionsStateFrom({ locationLearningEnabled: true, locationLearningCaptureState: "logout_cleanup" })).toBe("off");
    expect(suggestionsStateFrom({ locationLearningEnabled: false, locationLearningCaptureState: "off" })).toBe("off");
    expect(suggestionsStateFrom(null)).toBe("off");
    expect(locationResultText("always", "paused")).toMatch(/capture isn't running/);
    const [paused] = onboardingSummary({ ...EMPTY_ONBOARDING_ANSWERS, location: "always", suggestions: "paused" });
    expect(paused).toMatchObject({ state: "later", detail: "Capture paused, retry in Settings" });
  });

  it("words Apple Health by what was picked, and reminders by what iOS allowed (8-1b)", () => {
    expect(healthResultText("on", { sleep: true, workouts: false })).toMatch(/^Connected\. Dayframe reads the sleep you allowed/);
    expect(healthResultText("on", { sleep: true, workouts: true })).toMatch(/sleep and workouts and walks you allowed/);
    expect(remindersResultText("denied")).toMatch(/iPhone Settings/);
    const rows = onboardingSummary({ ...EMPTY_ONBOARDING_ANSWERS, health: "unavailable", reminders: "denied" });
    expect(rows[2]).toMatchObject({ key: "health", state: "none" });
    expect(rows[3]).toMatchObject({ key: "reminders", state: "later", detail: "Off" });
    const [, , health] = onboardingSummary({ ...EMPTY_ONBOARDING_ANSWERS, health: "on", healthPick: { sleep: false, workouts: true } });
    expect(health).toMatchObject({ state: "on", detail: "Workouts and walks" });
  });

  it("never reports Health or the reminder as on when saving failed (Codex r1 on #277)", () => {
    expect(healthResultText("failed", { sleep: true, workouts: false })).toMatch(/couldn't be saved/);
    expect(remindersResultText("failed")).toMatch(/couldn't be switched on/);
    const rows = onboardingSummary({ ...EMPTY_ONBOARDING_ANSWERS, health: "failed", reminders: "failed" });
    expect(rows[2]).toMatchObject({ key: "health", state: "later", detail: "Choices not saved" });
    expect(rows[3]).toMatchObject({ key: "reminders", state: "later", detail: "Off" });
  });
});
