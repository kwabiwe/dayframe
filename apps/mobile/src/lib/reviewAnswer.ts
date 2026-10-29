// Location v4 step 14, iPhone part 3b: a suggestion is answered where it sits, on its row in Calendar ›
// List, with exactly the effects the Review deck's "Log it" and "Skip" have. Both call the one rule here,
// so a choice saves the same mutation wherever it is made.
import { formatClockTime, placeQuestion, type ClockFormat, type ReviewMutation } from "@dayframe/shared";
import type { MobileReviewItem } from "./api";
import { hasSuggestedTimeWindow, hasV2LocationEvidence, isLocationReviewItem } from "./review";
import { reviewDeckOutingMutation } from "./reviewDeckOutings";
import type { ReviewLogAsEdit } from "./reviewLogAs";

/**
 * An Apple Maps place the iPhone guessed for an unnamed visit (card B part 2): the venue ranker's confident pick
 * near the stay, its street from Apple's address line, and its Place ID when iOS gives one.
 */
export type ReviewAnswerVenue = { name: string; street: string | null; applePlaceId: string | null };

/**
 * What an answer saves. An outing (its Moves' ids) is one `confirm_outing` / `ignore_outing`; "Log it"
 * with a real "Log as" change is `edit_and_confirm`; otherwise Location V2 evidence confirms or ignores
 * once, and every other suggestion accepts or ignores once.
 */
export function reviewAnswerMutation(
  item: MobileReviewItem,
  logged: boolean,
  options: {
    edit?: ReviewLogAsEdit | null; outingMemberIds?: readonly string[]; venue?: ReviewAnswerVenue | null;
    /** Yes to a guessed venue with an activity picked under Logs as (Codex r1 on #620): recorded there once, as that activity. */
    logAsCategoryId?: string | null;
  } = {}
): ReviewMutation {
  const edit = logged ? options.edit ?? null : null;
  if (options.outingMemberIds?.length) return reviewDeckOutingMutation(options.outingMemberIds, logged, edit);
  // Yes to "Visited {Apple place}?": the visit is recorded there once, as the editor's pick from Nearby does —
  // a one-time place, never a saved place or a rule (card B part 2).
  if (logged && options.venue && hasV2LocationEvidence(item)) {
    return { action: "record_poi_once", name: options.venue.name, ...(options.venue.applePlaceId ? { applePlaceId: options.venue.applePlaceId } : {}),
      ...(options.logAsCategoryId ? { edit: { categoryId: options.logAsCategoryId } } : {}) };
  }
  if (edit) return { action: "edit_and_confirm", edit };
  if (logged) return hasV2LocationEvidence(item) ? { action: "confirm" } : { action: "accept" };
  return hasV2LocationEvidence(item) ? { action: "ignore_once_location" } : { action: "ignore_once" };
}

/** The question a "?" asks under its row (mock-up #ios-list), and its one-tap answers. */
export type ReviewAnswerQuestion = {
  question: string;
  detail: string | null;
  /**
   * Null when the suggestion has no complete window, or has a change of its own waiting: the outbox refuses every
   * answer then, and the List only says why (step 15: there is no Review screen to open it on).
   */
  logLabel: string | null;
  skipLabel: string | null;
};

export function reviewAnswerQuestion(
  item: MobileReviewItem,
  clockFormat: ClockFormat,
  options: { outing?: boolean; pendingChange?: boolean; venue?: ReviewAnswerVenue | null } = {}
): ReviewAnswerQuestion {
  const question = reviewAnswerWords(item, clockFormat, options);
  // A waiting or rejected change of its own: the deck locked the card (Codex r10 on #582); it can't be answered yet.
  if (options.pendingChange) {
    return { ...question, detail: "A change to it is waiting or wasn't accepted, so it can't be answered yet.", logLabel: null, skipLabel: null };
  }
  // Every answer needs the whole window, as the deck's card did (Codex r1 and r3 on #582): it can't be answered.
  return hasSuggestedTimeWindow(item)
    ? question
    : { ...question, detail: "It has no complete time yet, so it can't be answered.", logLabel: null, skipLabel: null };
}

function reviewAnswerWords(
  item: MobileReviewItem,
  clockFormat: ClockFormat,
  options: { outing?: boolean; venue?: ReviewAnswerVenue | null }
): ReviewAnswerQuestion {
  const window = hasSuggestedTimeWindow(item)
    ? `${formatClockTime(new Date(item.suggestedStartedAt!), clockFormat)}–${formatClockTime(new Date(item.suggestedStoppedAt!), clockFormat)}`
    : null;
  const at = window ? `, ${window}` : "";
  const title = item.title?.trim() || "this";
  if (item.eventType === "health_sleep_import") {
    return { question: `Log your sleep${at}?`, detail: "From Apple Health.", logLabel: "Log as Sleep", skipLabel: "Not sleep" };
  }
  if (item.eventType === "health_workout_import") {
    const activity = item.categoryName?.trim() || "Workout";
    return { question: `Log the workout${at}?`, detail: "From Apple Health.", logLabel: `Log as ${activity}`, skipLabel: "Not a workout" };
  }

  // A trip asks by its own title, "Getting around, 14:44–16:31?" (card A, owner feedback 25 Oct): Yes logs it,
  // Edit is its sheet's, Not now leaves it.
  if (item.eventType === "commute_detected") {
    const name = title === "this" ? "Getting around" : title;
    return { question: `${name}${at}?`, detail: item.categoryName?.trim() ? `As ${item.categoryName.trim()}.` : null,
      logLabel: "Yes", skipLabel: "Not now" };
  }
  // A place asks "Visited {guess}?" with its times, or "Where were you?" (card B): Yes confirms the place it
  // names (an outing's trips there and back with it), Edit (its sheet) picks or names another,
  // Not now leaves it. With no guess, only Edit names it.
  // An unnamed visit with an Apple place the iPhone guessed nearby (card B part 2): "Visited {place}?", its
  // street and times under it; Yes records it there once.
  if (!options.outing && options.venue && hasV2LocationEvidence(item)) {
    return { question: `Visited ${options.venue.name}?`, detail: [options.venue.street, window].filter(Boolean).join(" · ") || null,
      logLabel: "Yes", skipLabel: "Not now" };
  }
  if (options.outing || isLocationReviewItem(item)) {
    const { question, guess } = placeQuestion(item.title);
    const edit = hasV2LocationEvidence(item);
    // A place from before Location V2 has no editor to name it: it keeps "Log it" (Codex r1 on #594).
    return { question, detail: window, logLabel: guess ? "Yes" : edit ? null : "Log it", skipLabel: "Not now" };
  }
  return {
    question: `Log ${title}${at}?`,
    detail: item.categoryName?.trim() ? `As ${item.categoryName.trim()}.` : null,
    logLabel: "Log it",
    skipLabel: "Skip"
  };
}
