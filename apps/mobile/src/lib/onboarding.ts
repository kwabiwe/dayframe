// First sign-in setup (Blocks parity step 8, prototype design/blocks/onboarding.html). The screen
// owns permissions and data; this file holds the step order and the words for each outcome, so
// they stay testable and the same everywhere (Done summary, Settings).
import type { DayframePaletteKey } from "@dayframe/shared";

export type OnboardingStep = "welcome" | "location" | "motion" | "health" | "reminders" | "done";

/** The steps this build walks through, in order. Quick starts join with 8-1c. */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = ["welcome", "location", "motion", "health", "reminders", "done"];

/** One progress block per permission step, filled in the logo's colours as each finishes. */
export const ONBOARDING_PROGRESS: readonly { step: OnboardingStep; color: DayframePaletteKey }[] = [
  { step: "location", color: "red" },
  { step: "motion", color: "amber" },
  { step: "health", color: "lime" },
  { step: "reminders", color: "blue" }
];

export type LocationChoice = "always" | "while" | "off";
export type MotionChoice = "on" | "off" | "unavailable";
/** "failed": access was asked for but the picks couldn't be saved (Try again). */
export type HealthChoice = "on" | "off" | "unavailable" | "failed";
/** "failed": allowed, but the reminder couldn't be switched on (Try again). */
export type RemindersChoice = "on" | "off" | "denied" | "failed";
/** What Apple Health may bring in: sleep, and workouts and walks. */
export type HealthPick = { sleep: boolean; workouts: boolean };

/**
 * The account's visit and journey suggestions, separate from iOS permission: "on" only while
 * capture is actually running; "paused" when the consent is saved but capture isn't running
 * (an interrupted switch-on; Settings calls it Retry capture).
 */
export type SuggestionsState = "on" | "off" | "paused" | "failed";

/** Reads the account's suggestions from Location diagnostics (consent plus the capture state). */
export function suggestionsStateFrom(diagnostics: { locationLearningEnabled?: boolean; locationLearningCaptureState?: string } | null | undefined): SuggestionsState {
  if (!diagnostics?.locationLearningEnabled) return "off";
  if (diagnostics.locationLearningCaptureState === "active") return "on";
  if (diagnostics.locationLearningCaptureState === "inactive") return "paused";
  return "off";
}

export type OnboardingAnswers = {
  location: LocationChoice | null;
  suggestions: SuggestionsState;
  /** Location's second ask: While Using was given, the Always explainer is showing. */
  locationStage: "explain" | "upgrade";
  motion: MotionChoice | null;
  health: HealthChoice | null;
  healthPick: HealthPick;
  reminders: RemindersChoice | null;
};

export const EMPTY_ONBOARDING_ANSWERS: OnboardingAnswers = {
  location: null,
  suggestions: "off",
  locationStage: "explain",
  motion: null,
  health: null,
  healthPick: { sleep: true, workouts: true },
  reminders: null
};

export function nextOnboardingStep(step: OnboardingStep): OnboardingStep {
  const index = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.min(index + 1, ONBOARDING_STEPS.length - 1)];
}

export function previousOnboardingStep(step: OnboardingStep): OnboardingStep {
  const index = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.max(index - 1, 0)];
}

/** How many progress blocks are filled while `step` is showing (steps before it are done). */
export function onboardingProgressDone(step: OnboardingStep) {
  const index = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_PROGRESS.filter((item) => ONBOARDING_STEPS.indexOf(item.step) < index).length;
}

/** Back shows from the first permission step until the summary; Later skips to the summary. */
export function onboardingChrome(step: OnboardingStep) {
  return { back: step !== "welcome" && step !== "done", later: step !== "welcome" && step !== "done" };
}

/** iOS location permission as onboarding sees it. */
export function locationChoiceFromPermissions(foregroundGranted: boolean, backgroundGranted: boolean): LocationChoice | null {
  if (backgroundGranted) return "always";
  if (foregroundGranted) return "while";
  return null;
}

/** The line under the Location step once it is answered. Suggestions need Always in this app. */
export function locationResultText(choice: LocationChoice, suggestions: SuggestionsState = "on") {
  switch (choice) {
    case "always":
      if (suggestions === "failed") return "Suggestions couldn't be switched on. Try again, or turn them on later in Settings.";
      if (suggestions === "paused") return "Suggestions are on, but location capture isn't running. Retry to start it.";
      if (suggestions === "off") return "iOS allows Always. Turn on suggestions to see visits and journeys in Review.";
      return "Location is on, including when your phone is locked.";
    case "while":
      return "Location works while Dayframe is open. Visit and journey suggestions need Always, which you can switch on in Settings › Location.";
    case "off":
      return "Location is off. Timers, Review and Apple Health still work. You can turn it on later in Settings.";
  }
}

export function motionResultText(choice: MotionChoice) {
  switch (choice) {
    case "on":
      return "Motion & Fitness is on.";
    case "off":
      return "Motion is off. Trips still work from location, with less detail on short drives. Turn it on later in Settings.";
    case "unavailable":
      return "This iPhone doesn't record motion. Trips still work from location.";
  }
}

export function healthPickText(pick: HealthPick) {
  return [pick.sleep && "Sleep", pick.workouts && "Workouts and walks"].filter(Boolean).join(" · ");
}

export function healthResultText(choice: HealthChoice, pick: HealthPick) {
  switch (choice) {
    case "on":
      // iOS never tells an app whether read access was refused, so this says what was asked for.
      return `Connected. Dayframe reads the ${[pick.sleep && "sleep", pick.workouts && "workouts and walks"].filter(Boolean).join(" and ")} you allowed in the Health sheet; change that any time in the Health app.`;
    case "off":
      return "Apple Health isn't connected. Sleep and workouts won't come in until you connect it in Settings.";
    case "unavailable":
      return "Apple Health isn't available on this device.";
    case "failed":
      return "Your choices couldn't be saved. Try again, or choose them in Settings › Apple Health.";
  }
}

export function remindersResultText(choice: RemindersChoice) {
  switch (choice) {
    case "on":
      return "Evening reminders are on.";
    case "off":
      return "No reminders. Review still shows a count on Today.";
    case "denied":
      return "Notifications are off for Dayframe in iPhone Settings. Allow them there, then turn on Evening reminder in Settings.";
    case "failed":
      return "The reminder couldn't be switched on. Try again, or turn it on later in Settings.";
  }
}

/** A Done summary row: on, or waiting in Settings for later. */
/** "none": nothing to turn on later (this iPhone has no motion chip). */
export type OnboardingSummaryRow = { key: "location" | "motion" | "health" | "reminders"; title: string; detail: string; state: "on" | "later" | "none" };

export function onboardingSummary(answers: OnboardingAnswers): OnboardingSummaryRow[] {
  return [
    {
      key: "location",
      title: "Location",
      state: answers.location === "always" && answers.suggestions === "on" ? "on" : "later",
      detail: answers.location === "always"
        ? answers.suggestions === "on"
          ? "Always, including locked"
          : answers.suggestions === "failed"
            ? "Suggestions couldn't be switched on"
            : answers.suggestions === "paused" ? "Capture paused, retry in Settings" : "Suggestions are off"
        : answers.location === "while"
          ? "Suggestions need Always"
          : "Visits and journeys are off"
    },
    {
      key: "motion",
      title: "Motion & Fitness",
      state: answers.motion === "on" ? "on" : answers.motion === "unavailable" ? "none" : "later",
      detail: answers.motion === "on"
        ? "Walking and driving detection"
        : answers.motion === "unavailable"
          ? "Not available on this iPhone"
          : "Short drives may be missed"
    },
    {
      key: "health",
      title: "Apple Health",
      state: answers.health === "on" ? "on" : answers.health === "unavailable" ? "none" : "later",
      detail: answers.health === "on"
        ? healthPickText(answers.healthPick)
        : answers.health === "unavailable"
          ? "Not available on this device"
          : answers.health === "failed" ? "Choices not saved" : "Not connected"
    },
    {
      key: "reminders",
      title: "Reminders",
      state: answers.reminders === "on" ? "on" : "later",
      detail: answers.reminders === "on" ? "One evening nudge" : "Off"
    }
  ];
}
