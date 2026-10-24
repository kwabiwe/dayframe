// Location v4 step 14, iPhone part 3b: a suggestion is answered where it sits, on its row in Calendar ›
// List, with exactly the effects the Review deck's "Log it" and "Skip" have. Both call the one rule here,
// so a choice saves the same mutation wherever it is made.
import { formatClockTime, type ClockFormat, type ReviewMutation } from "@dayframe/shared";
import type { MobileReviewItem } from "./api";
import { hasSuggestedTimeWindow, hasV2LocationEvidence, isLocationReviewItem } from "./review";
import { reviewDeckOutingMutation } from "./reviewDeckOutings";
import type { ReviewLogAsEdit } from "./reviewLogAs";

/**
 * What an answer saves. An outing (its Moves' ids) is one `confirm_outing` / `ignore_outing`; "Log it"
 * with a real "Log as" change is `edit_and_confirm`; otherwise Location V2 evidence confirms or ignores
 * once, and every other suggestion accepts or ignores once.
 */
export function reviewAnswerMutation(
  item: MobileReviewItem,
  logged: boolean,
  options: { edit?: ReviewLogAsEdit | null; outingMemberIds?: readonly string[] } = {}
): ReviewMutation {
  const edit = logged ? options.edit ?? null : null;
  if (options.outingMemberIds?.length) return reviewDeckOutingMutation(options.outingMemberIds, logged, edit);
  if (edit) return { action: "edit_and_confirm", edit };
  if (logged) return hasV2LocationEvidence(item) ? { action: "confirm" } : { action: "accept" };
  return hasV2LocationEvidence(item) ? { action: "ignore_once_location" } : { action: "ignore_once" };
}

/** The question a "?" asks under its row (mock-up #ios-list), and its one-tap answers. */
export type ReviewAnswerQuestion = {
  question: string;
  detail: string | null;
  logLabel: string;
  skipLabel: string;
  /** A place can be picked or named on the suggestion's own screen ("More…"). */
  more: boolean;
};

export function reviewAnswerQuestion(
  item: MobileReviewItem,
  clockFormat: ClockFormat,
  options: { outing?: boolean } = {}
): ReviewAnswerQuestion {
  const window = hasSuggestedTimeWindow(item)
    ? `${formatClockTime(new Date(item.suggestedStartedAt!), clockFormat)}–${formatClockTime(new Date(item.suggestedStoppedAt!), clockFormat)}`
    : null;
  const at = window ? `, ${window}` : "";
  const title = item.title?.trim() || "this";
  if (item.eventType === "health_sleep_import") {
    return { question: `Log your sleep${at}?`, detail: "From Apple Health.", logLabel: "Log as Sleep", skipLabel: "Not sleep", more: false };
  }
  if (item.eventType === "health_workout_import") {
    const activity = item.categoryName?.trim() || "Workout";
    return { question: `Log the workout${at}?`, detail: "From Apple Health.", logLabel: `Log as ${activity}`, skipLabel: "Not a workout", more: false };
  }
  if (options.outing) {
    return { question: `Log ${title} with the trips there and back${at}?`, detail: "One answer for the whole outing.", logLabel: "Log it", skipLabel: "Skip", more: false };
  }
  if (item.eventType === "commute_detected") {
    return { question: `Log the trip${at}?`, detail: title === "this" ? null : title, logLabel: "Log it", skipLabel: "Not a trip", more: false };
  }
  // A place: logged as suggested here; picking or naming another place happens on its own screen.
  const place = isLocationReviewItem(item);
  return {
    question: `Log ${title}${at}?`,
    detail: item.categoryName?.trim() ? `As ${item.categoryName.trim()}.` : null,
    logLabel: "Log it",
    skipLabel: place ? "Not now" : "Skip",
    more: place && hasV2LocationEvidence(item)
  };
}
