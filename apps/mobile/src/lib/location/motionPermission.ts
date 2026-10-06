import type { DayframeMotionAuthorizationStatus } from "../../../modules/dayframe-motion-activity";

export type MotionFitnessPresentation = {
  label: string;
  detail: string;
  action: { kind: "request" | "open_settings"; label: string } | null;
};

/**
 * Settings copy for Motion & Fitness. iOS permission is shown separately from
 * whether Location suggestions (the account consent that admits the evidence) are on.
 */
export function motionFitnessPresentation(
  status: DayframeMotionAuthorizationStatus,
  locationSuggestionsOn: boolean
): MotionFitnessPresentation {
  switch (status) {
    case "authorized":
      return {
        label: "Allowed",
        detail: locationSuggestionsOn
          ? "Walking and driving activity times your journeys and finds short drives GPS missed. It never logs time by itself."
          : "Used only while location suggestions are on.",
        action: null
      };
    case "not_determined":
      return {
        label: "Not requested",
        detail: "Lets Dayframe tell walking from driving and time journeys more precisely.",
        action: { kind: "request", label: "Allow Motion & Fitness" }
      };
    case "denied":
      return {
        label: "Off",
        detail: "Turn on Motion & Fitness for Dayframe in iOS Settings to time journeys more precisely.",
        action: { kind: "open_settings", label: "Open iOS Settings" }
      };
    case "restricted":
      return {
        label: "Restricted",
        detail: "Motion & Fitness is restricted on this iPhone, for example by Screen Time.",
        action: { kind: "open_settings", label: "Open iOS Settings" }
      };
    case "unavailable":
      return { label: "Not available", detail: "This device does not record motion activity.", action: null };
    default:
      return { label: "Unknown", detail: "Motion & Fitness status could not be read.", action: { kind: "open_settings", label: "Open iOS Settings" } };
  }
}

export async function readMotionFitnessStatus(): Promise<DayframeMotionAuthorizationStatus> {
  try {
    const native = await import("../../../modules/dayframe-motion-activity");
    return native.getAuthorizationStatus();
  } catch {
    return "unavailable";
  }
}

/** Shows the iOS prompt when it has not been answered; otherwise returns the current status. */
export async function requestMotionFitness(): Promise<DayframeMotionAuthorizationStatus> {
  try {
    const native = await import("../../../modules/dayframe-motion-activity");
    return await native.requestAuthorization();
  } catch {
    return readMotionFitnessStatus();
  }
}
