// Location v4 step 14, iPhone part 3b: a suggestion is answered where it sits, on its row in Calendar ›
// List, with exactly the effects the Review deck's "Log it" and "Skip" have. Both call the one rule here,
// so a choice saves the same mutation wherever it is made.
import { formatClockTime, placeQuestion, type ClockFormat, type ReviewMutation } from "@dayframe/shared";
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
  /** Null when the suggestion has no complete window: the outbox refuses every answer without one. */
  logLabel: string | null;
  skipLabel: string | null;
  /** No complete window: it is answered on its own screen ("Open it") instead of here. */
  opens: boolean;
  /** A place can be picked or named on the suggestion's own screen ("More…"), a trip edited there ("Edit"). */
  more: boolean;
  /** The words on that button when they are not "More…". */
  moreLabel?: string;
};

export function reviewAnswerQuestion(
  item: MobileReviewItem,
  clockFormat: ClockFormat,
  options: { outing?: boolean; pendingChange?: boolean } = {}
): ReviewAnswerQuestion {
  const question = reviewAnswerWords(item, clockFormat, options);
  // A waiting or rejected change of its own: the deck locks the card, so it opens instead (Codex r10 on #582).
  if (options.pendingChange) {
    return { ...question, detail: "A change to it is waiting or wasn't accepted, so it can't be answered here.", logLabel: null, skipLabel: null, more: false, opens: true };
  }
  // Every answer needs the whole window, as on the suggestion's deck card, which only moves such a card
  // back (Codex r1 and r3 on #582): it opens on its own screen instead.
  return hasSuggestedTimeWindow(item)
    ? question
    : { ...question, detail: "It has no complete time yet, so it can't be answered here.", logLabel: null, skipLabel: null, more: false, opens: true };
}

function reviewAnswerWords(
  item: MobileReviewItem,
  clockFormat: ClockFormat,
  options: { outing?: boolean }
): ReviewAnswerQuestion {
  const window = hasSuggestedTimeWindow(item)
    ? `${formatClockTime(new Date(item.suggestedStartedAt!), clockFormat)}–${formatClockTime(new Date(item.suggestedStoppedAt!), clockFormat)}`
    : null;
  const at = window ? `, ${window}` : "";
  const title = item.title?.trim() || "this";
  if (item.eventType === "health_sleep_import") {
    return { question: `Log your sleep${at}?`, detail: "From Apple Health.", logLabel: "Log as Sleep", skipLabel: "Not sleep", more: false, opens: false };
  }
  if (item.eventType === "health_workout_import") {
    const activity = item.categoryName?.trim() || "Workout";
    return { question: `Log the workout${at}?`, detail: "From Apple Health.", logLabel: `Log as ${activity}`, skipLabel: "Not a workout", more: false, opens: false };
  }

  // A trip asks by its own title, "Getting around, 14:44–16:31?" (card A, owner feedback 25 Oct): Yes logs it,
  // Edit opens it on its own screen, Not now leaves it.
  if (item.eventType === "commute_detected") {
    const name = title === "this" ? "Getting around" : title;
    return { question: `${name}${at}?`, detail: item.categoryName?.trim() ? `As ${item.categoryName.trim()}.` : null,
      logLabel: "Yes", skipLabel: "Not now", more: true, moreLabel: "Edit", opens: false };
  }
  // A place asks "Visited {guess}?" with its times, or "Where were you?" (card B): Yes confirms the place it
  // names (an outing's trips there and back with it), Edit opens it on its own screen to pick or name another,
  // Not now leaves it. With no guess, only Edit names it.
  if (options.outing || isLocationReviewItem(item)) {
    const { question, guess } = placeQuestion(item.title);
    const edit = hasV2LocationEvidence(item);
    return { question, detail: window, logLabel: guess ? "Yes" : null, skipLabel: "Not now", more: edit,
      ...(edit ? { moreLabel: "Edit" } : {}), opens: false };
  }
  return {
    question: `Log ${title}${at}?`,
    detail: item.categoryName?.trim() ? `As ${item.categoryName.trim()}.` : null,
    logLabel: "Log it",
    skipLabel: "Skip",
    more: false,
    opens: false
  };
}
