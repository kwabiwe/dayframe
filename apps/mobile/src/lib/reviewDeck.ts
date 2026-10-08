// Blocks parity step 5a: the pure presentation model behind the iPhone Review deck.
// The deck shows one Review card at a time over at most two cards beneath it.

export type ReviewDeckPicture = "place" | "commute" | "workout" | "sleep" | "suggestion";
export type ReviewDeckSourceIcon = "pin" | "route" | "walk" | "moon" | "spark";

export const REVIEW_DECK_VISIBLE_CARDS = 3;
/** Each card beneath the top one sits this much lower and 5 % smaller (prototype `.card`). */
export const REVIEW_DECK_DEPTH_OFFSET = 14;
export const REVIEW_DECK_DEPTH_SCALE = 0.05;

/** Swipe (Blocks parity step 5b, prototype `wireCard`): past ±110 points a release decides. */
export const REVIEW_DECK_THROW_THRESHOLD = 110;
/** A decided card flies this far in 340 ms with cubic-bezier(.3, .6, .4, 1); it tilts dx/18°. */
export const REVIEW_DECK_FLING = { distance: 520, durationMs: 340, easing: [0.3, 0.6, 0.4, 1] as const, lift: 100 };
/** Undo flies the card back in from this far out. */
export const REVIEW_DECK_RETURN_FROM = 420;
export const REVIEW_DECK_TILT_DIVISOR = 18;
/** Vertical drag follows the finger at 40 %. */
export const REVIEW_DECK_VERTICAL_FOLLOW = 0.4;

/**
 * Which way a dragged card is armed. The card must sit past the threshold and the finger must have
 * travelled past it in the same direction, so a card caught on its way home does not arm at once.
 */
export function reviewDeckArmDirection(cardX: number, fingerTravel: number): -1 | 0 | 1 {
  "worklet";
  if (cardX > REVIEW_DECK_THROW_THRESHOLD && fingerTravel > REVIEW_DECK_THROW_THRESHOLD) return 1;
  if (cardX < -REVIEW_DECK_THROW_THRESHOLD && fingerTravel < -REVIEW_DECK_THROW_THRESHOLD) return -1;
  return 0;
}

type ReviewKindInput = {
  eventSource: string | null;
  eventType: string | null;
};

function isHealth(input: ReviewKindInput) {
  return Boolean(input.eventSource?.startsWith("health_") || input.eventType?.startsWith("health_"));
}

function isSleep(input: ReviewKindInput) {
  return Boolean(input.eventType?.startsWith("health_sleep") || input.eventSource?.startsWith("health_sleep"));
}

export function reviewDeckPicture(input: ReviewKindInput & { isLocation: boolean; isTimeAway: boolean }): ReviewDeckPicture {
  if (input.eventType === "commute_detected" && !input.isTimeAway) return "commute";
  if (isSleep(input)) return "sleep";
  if (isHealth(input)) return "workout";
  if (input.isLocation || input.isTimeAway) return "place";
  return "suggestion";
}

export function reviewDeckSource(input: ReviewKindInput & { isLocation: boolean; isTimeAway: boolean }): {
  icon: ReviewDeckSourceIcon;
  label: string;
} {
  const picture = reviewDeckPicture(input);
  if (picture === "sleep") return { icon: "moon", label: "Apple Health" };
  if (picture === "workout") return { icon: "walk", label: "Apple Health" };
  if (picture === "commute") return { icon: "route", label: "Location" };
  if (picture === "place") return { icon: "pin", label: "Location" };
  return { icon: "spark", label: "Suggestion" };
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

function clock(date: Date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function localDayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const SHORT_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

export function formatReviewDeckDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * The prototype's when-line: "Today · 21:19–21:26 · 7m". The day word is Today, Yesterday or a
 * short date ("Mon 6 Oct"); a range that crosses midnight names the end's day too.
 */
export function formatReviewDeckWhen(
  startedAt: string | null,
  stoppedAt: string | null,
  durationSeconds: number,
  now: number
): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return null;
  const today = localDayStart(new Date(now));
  const yesterday = localDayStart(new Date(today - 12 * 3600 * 1000));
  const dayWord = (date: Date) => {
    const day = localDayStart(date);
    if (day === today) return "Today";
    if (day === yesterday) return "Yesterday";
    return SHORT_DAY.format(date).replace(",", "");
  };
  const stop = stoppedAt ? new Date(stoppedAt) : null;
  const parts = [dayWord(start)];
  if (stop && !Number.isNaN(stop.getTime())) {
    parts.push(
      localDayStart(stop) === localDayStart(start)
        ? `${clock(start)}–${clock(stop)}`
        : `${clock(start)}–${dayWord(stop)} ${clock(stop)}`
    );
  } else {
    parts.push(clock(start));
  }
  if (durationSeconds > 0) parts.push(formatReviewDeckDuration(durationSeconds));
  return parts.join(" · ");
}

/** The exact-focus target (a Today ribbon tap) leads the deck; the order is otherwise kept. */
export function orderReviewDeck<T extends { key: string }>(cards: readonly T[], focusKey: string | null): T[] {
  if (!focusKey) return [...cards];
  const index = cards.findIndex((card) => card.key === focusKey);
  if (index <= 0) return [...cards];
  return [cards[index], ...cards.slice(0, index), ...cards.slice(index + 1)];
}

/**
 * "2 of 5": decided this visit plus the card on top, out of decided plus what is left. When the
 * server count is not exact yet, the total is what is loaded and is marked "at least".
 */
export function reviewDeckPosition(input: {
  decided: number;
  remaining: number;
  exact: boolean;
}): { text: string; accessibilityLabel: string } | null {
  if (input.remaining <= 0) return null;
  const current = input.decided + 1;
  const total = input.decided + input.remaining;
  return input.exact
    ? { text: `${current} of ${total}`, accessibilityLabel: `Moment ${current} of ${total}` }
    : { text: `${current} of ${total}+`, accessibilityLabel: `Moment ${current} of at least ${total}` };
}

/** Outbox states the server has not applied yet. */
const UNAPPLIED_OUTBOX_STATES = new Set(["pending", "in_flight", "retry_wait", "auth_required", "delivery_interrupted"]);

/**
 * "N of M" remaining (Blocks parity step 5d). When every open item is loaded the deck is the count.
 * Otherwise it is the last server count minus this account's decisions that count does not reflect
 * yet, deduplicated by item: held or saving on this iPhone, queued but not applied, or acknowledged
 * after that count's read started (all times on this iPhone's clock). Never fewer than the cards
 * loaded. (A decision the server applied whose reply was lost still looks queued here; it corrects
 * itself when the outbox settles.)
 */
export function reviewDeckRemaining(input: {
  backlogComplete: boolean;
  deckRemaining: number;
  /** null until a backlog read has given a server count. */
  serverOpenCount: number | null;
  /** When the read that produced serverOpenCount started (ms). */
  countReadStartedAt: number | null;
  /** Items decided on this iPhone but not in the outbox yet (held for Undo, saving). */
  localItemIds: readonly string[];
  outbox: readonly { reviewItemId: string; state: string; updatedAt: string }[];
}) {
  if (input.backlogComplete || input.serverOpenCount === null) return input.deckRemaining;
  const unreflected = new Set(input.localItemIds);
  for (const mutation of input.outbox) {
    if (UNAPPLIED_OUTBOX_STATES.has(mutation.state)) {
      unreflected.add(mutation.reviewItemId);
    } else if (mutation.state === "acknowledged") {
      const acknowledgedAt = Date.parse(mutation.updatedAt);
      if (input.countReadStartedAt === null || !Number.isFinite(acknowledgedAt) || acknowledgedAt >= input.countReadStartedAt) {
        unreflected.add(mutation.reviewItemId);
      }
    }
  }
  return Math.max(input.serverOpenCount - unreflected.size, input.deckRemaining);
}
