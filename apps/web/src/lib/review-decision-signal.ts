/**
 * The owner-authored signal for Recent description suggestions (E1, Codex r2).
 *
 * A location Review decision records, on the activity event its time entry is created from,
 * whether the saved description is text the owner typed while deciding. Only the server's
 * Review actions write this key; client-ingested event payloads have it removed, so a phone or
 * integration can never claim it. Recent (tier 2) learns only from blocks carrying it.
 */
export const REVIEW_DECISION_PAYLOAD_KEY = "dayframeReviewDecision";

/** The payload fragment stored under `REVIEW_DECISION_PAYLOAD_KEY`. */
export type ReviewDecisionPayload = { ownerAuthoredDescription: true };

/**
 * Raw-payload key holding every title Dayframe suggested along a Review correction chain
 * (split/merge parts), so a later decision can tell an inherited title from one the owner typed.
 */
export const REVIEW_SUGGESTED_TITLES_PAYLOAD_KEY = "reviewSuggestedTitles";

/**
 * Caseless comparison key for Review titles: compatibility normalisation (fullwidth letters,
 * ligatures such as "ﬁ", NFC/NFD accents), full Unicode case folding approximated by upper- then
 * lower-casing (so "ß" matches "SS"), the dotted capital I folded like a plain "i", and repeated
 * whitespace collapsed. Every owner-authored comparison, including the title history, uses it.
 */
export function foldReviewText(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    // Twice, so the capital sharp s ("ẞ" → "ß" → "SS") folds like "ß" and "SS".
    .toUpperCase()
    .toLowerCase()
    .toUpperCase()
    .toLowerCase()
    .normalize("NFKD")
    // "İ" lower-cases to "i" + combining dot above; fold it like "i" (and "ı" already became "i").
    .replace(/i\u0307/gu, "i")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * True only when a non-empty saved description differs from every title Dayframe suggested
 * (compared with `foldReviewText`: Unicode case folding, compatibility forms, repeated spaces). A suggestion accepted as is, or edited back
 * to it, is Dayframe's text, not the owner's.
 */
export function isOwnerAuthoredReviewDescription(
  description: string | null | undefined,
  suggestedTitles: readonly (string | null | undefined)[]
) {
  const key = foldReviewText(description);
  if (!key) return false;
  return !suggestedTitles.some((title) => foldReviewText(title) === key);
}

/**
 * The Dayframe-suggested titles a locked Review item stands for: every title recorded in its
 * event's history (replay retitles included) plus, for a Dayframe suggestion, its current title.
 * A correction part's own title may be the owner's words, so for corrections only the chain's
 * recorded history counts (falling back to the title for correction events from before it).
 */
export function reviewSuggestedTitles(payloadTitles: unknown, itemTitle: string, options: { correction?: boolean } = {}) {
  const history = Array.isArray(payloadTitles)
    ? payloadTitles.filter((title): title is string => typeof title === "string" && title.trim().length > 0)
    : [];
  if (options.correction) return history.length > 0 ? [...new Set(history)] : [itemTitle];
  return [...new Set([...history, itemTitle])];
}

/** Removes the server-only Review decision keys from a client-supplied event payload. */
export function withoutServerReviewDecision<T extends Record<string, unknown>>(payload: T): T {
  if (!payload || typeof payload !== "object") return payload;
  if (!(REVIEW_DECISION_PAYLOAD_KEY in payload) && !(REVIEW_SUGGESTED_TITLES_PAYLOAD_KEY in payload)) return payload;
  const rest: Record<string, unknown> = { ...payload };
  delete rest[REVIEW_DECISION_PAYLOAD_KEY];
  delete rest[REVIEW_SUGGESTED_TITLES_PAYLOAD_KEY];
  return rest as T;
}
