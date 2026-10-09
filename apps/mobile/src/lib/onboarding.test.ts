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
  previousOnboardingStep
} from "./onboarding";

describe("onboarding steps", () => {
  it("walks welcome → location → motion → done and back, never past either end", () => {
    expect(ONBOARDING_STEPS).toEqual(["welcome", "location", "motion", "done"]);
    expect(nextOnboardingStep("welcome")).toBe("location");
    expect(nextOnboardingStep("motion")).toBe("done");
    expect(nextOnboardingStep("done")).toBe("done");
    expect(previousOnboardingStep("location")).toBe("welcome");
    expect(previousOnboardingStep("welcome")).toBe("welcome");
  });

  it("fills one progress block per finished permission step, in the logo's colours", () => {
    expect(ONBOARDING_PROGRESS.map((item) => item.color)).toEqual(["red", "amber"]);
    expect(onboardingProgressDone("welcome")).toBe(0);
    expect(onboardingProgressDone("location")).toBe(0);
    expect(onboardingProgressDone("motion")).toBe(1);
    expect(onboardingProgressDone("done")).toBe(2);
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
    expect(rows).toEqual([
      expect.objectContaining({ key: "location", state: "later", detail: "Suggestions need Always" }),
      expect.objectContaining({ key: "motion", state: "none", detail: "Not available on this iPhone" })
    ]);
    expect(onboardingSummary({ ...EMPTY_ONBOARDING_ANSWERS, location: "always", suggestions: "on", motion: "on" }).map((row) => row.state)).toEqual(["on", "on"]);
  });

  it("keeps Always permission apart from this account's suggestions (Codex r1)", () => {
    expect(locationResultText("always", "off")).toMatch(/Turn on suggestions/);
    expect(locationResultText("always", "failed")).toMatch(/couldn't be switched on/);
    const [notOptedIn] = onboardingSummary({ ...EMPTY_ONBOARDING_ANSWERS, location: "always", suggestions: "off" });
    expect(notOptedIn).toMatchObject({ state: "later", detail: "Suggestions are off" });
    const [failed] = onboardingSummary({ ...EMPTY_ONBOARDING_ANSWERS, location: "always", suggestions: "failed" });
    expect(failed).toMatchObject({ state: "later", detail: "Suggestions couldn't be switched on" });
  });
});
