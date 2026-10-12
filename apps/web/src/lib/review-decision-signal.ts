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

function normalizedReviewText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

/**
 * True only when a non-empty saved description differs from every title Dayframe suggested
 * (ignoring case, Unicode form and repeated spaces). A suggestion accepted as is, or edited back
 * to it, is Dayframe's text, not the owner's.
 */
export function isOwnerAuthoredReviewDescription(
  description: string | null | undefined,
  suggestedTitles: readonly (string | null | undefined)[]
) {
  const key = normalizedReviewText(description);
  if (!key) return false;
  return !suggestedTitles.some((title) => normalizedReviewText(title) === key);
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
