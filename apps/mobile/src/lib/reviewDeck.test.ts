import { describe, expect, it } from "vitest";
import {
  formatReviewDeckWhen,
  orderReviewDeck,
  reviewDeckArmDirection,
  reviewDeckRemaining,
  reviewDeckPicture,
  reviewDeckPosition,
  reviewDeckSource
} from "./reviewDeck";

const base = { eventSource: null, eventType: null, isLocation: false, isTimeAway: false };

describe("reviewDeckPicture", () => {
  it("draws a picture by kind", () => {
    expect(reviewDeckPicture({ ...base, eventType: "commute_detected" })).toBe("commute");
    expect(reviewDeckPicture({ ...base, eventType: "commute_detected", isTimeAway: true })).toBe("place");
    expect(reviewDeckPicture({ ...base, eventSource: "health_sleep", eventType: "health_sleep_import" })).toBe("sleep");
    expect(reviewDeckPicture({ ...base, eventSource: "health_workout", eventType: "health_workout_import" })).toBe("workout");
    expect(reviewDeckPicture({ ...base, isLocation: true })).toBe("place");
    expect(reviewDeckPicture(base)).toBe("suggestion");
  });

  it("names the source with a matching icon", () => {
    expect(reviewDeckSource({ ...base, eventType: "health_sleep_import" })).toEqual({ icon: "moon", label: "Apple Health" });
    expect(reviewDeckSource({ ...base, isLocation: true })).toEqual({ icon: "pin", label: "Location" });
    expect(reviewDeckSource(base)).toEqual({ icon: "spark", label: "Suggestion" });
  });
});

describe("formatReviewDeckWhen", () => {
  const now = new Date(2026, 9, 8, 12, 0).getTime();

  it("uses Today, Yesterday or a short date with the range and duration", () => {
    expect(formatReviewDeckWhen(
      new Date(2026, 9, 8, 9, 5).toISOString(),
      new Date(2026, 9, 8, 10, 40).toISOString(),
      95 * 60,
      now
    )).toBe("Today · 09:05–10:40 · 1h 35m");
    expect(formatReviewDeckWhen(
      new Date(2026, 9, 7, 21, 19).toISOString(),
      new Date(2026, 9, 7, 21, 26).toISOString(),
      7 * 60,
      now
    )).toBe("Yesterday · 21:19–21:26 · 7m");
    expect(formatReviewDeckWhen(
      new Date(2026, 9, 5, 9, 0).toISOString(),
      new Date(2026, 9, 5, 11, 0).toISOString(),
      2 * 3600,
      now
    )).toBe("Mon 5 Oct · 09:00–11:00 · 2h");
  });

  it("names the end's day when the range crosses midnight", () => {
    expect(formatReviewDeckWhen(
      new Date(2026, 9, 7, 23, 18).toISOString(),
      new Date(2026, 9, 8, 6, 30).toISOString(),
      (7 * 60 + 12) * 60,
      now
    )).toBe("Yesterday · 23:18–Today 06:30 · 7h 12m");
  });

  it("returns null without a usable start", () => {
    expect(formatReviewDeckWhen(null, null, 0, now)).toBeNull();
    expect(formatReviewDeckWhen("nope", null, 0, now)).toBeNull();
  });
});

describe("orderReviewDeck", () => {
  const cards = [{ key: "a" }, { key: "b" }, { key: "c" }];

  it("moves the focused card to the top and keeps the rest in order", () => {
    expect(orderReviewDeck(cards, "c").map((card) => card.key)).toEqual(["c", "a", "b"]);
    expect(orderReviewDeck(cards, "a").map((card) => card.key)).toEqual(["a", "b", "c"]);
    expect(orderReviewDeck(cards, "missing").map((card) => card.key)).toEqual(["a", "b", "c"]);
    expect(orderReviewDeck(cards, null).map((card) => card.key)).toEqual(["a", "b", "c"]);
  });
});

describe("reviewDeckPosition", () => {
  it("counts the card on top among decided and remaining", () => {
    expect(reviewDeckPosition({ decided: 0, remaining: 5, exact: true })).toEqual({
      text: "1 of 5",
      accessibilityLabel: "Moment 1 of 5"
    });
    expect(reviewDeckPosition({ decided: 2, remaining: 3, exact: true })?.text).toBe("3 of 5");
    expect(reviewDeckPosition({ decided: 0, remaining: 4, exact: false })).toEqual({
      text: "1 of 4+",
      accessibilityLabel: "Moment 1 of at least 4"
    });
    expect(reviewDeckPosition({ decided: 3, remaining: 0, exact: true })).toBeNull();
  });
});

describe("reviewDeckArmDirection (5b swipe arming)", () => {
  it("arms once the card and the finger are both past the threshold", () => {
    expect(reviewDeckArmDirection(130, 130)).toBe(1);
    expect(reviewDeckArmDirection(-130, -130)).toBe(-1);
    expect(reviewDeckArmDirection(100, 100)).toBe(0);
  });

  it("does not arm a card caught on its way home until the finger travels", () => {
    // Caught at 100 points while springing back; 20 points more puts the card past 110.
    expect(reviewDeckArmDirection(120, 20)).toBe(0);
    expect(reviewDeckArmDirection(-120, -20)).toBe(0);
    expect(reviewDeckArmDirection(230, 120)).toBe(1);
  });
});

describe("reviewDeckRemaining", () => {
  const readAt = Date.parse("2026-10-08T12:00:00.000Z");
  const before = "2026-10-08T11:59:00.000Z";
  const after = "2026-10-08T12:00:30.000Z";
  const base = { backlogComplete: false, deckRemaining: 56, serverOpenCount: 160, countReadStartedAt: readAt, localItemIds: [] as string[], outbox: [] as { reviewItemId: string; state: string; updatedAt: string }[] };

  it("uses the deck when everything is loaded, and the deck until a server count exists", () => {
    expect(reviewDeckRemaining({ ...base, backlogComplete: true, deckRemaining: 12 })).toBe(12);
    expect(reviewDeckRemaining({ ...base, serverOpenCount: null })).toBe(56);
  });

  it("keeps the total through held, saving, queued and acknowledged-after-read (160 never becomes 161 or 56)", () => {
    expect(reviewDeckRemaining({ ...base, localItemIds: ["a"] })).toBe(159);
    expect(reviewDeckRemaining({ ...base, localItemIds: ["a"], outbox: [{ reviewItemId: "a", state: "pending", updatedAt: after }] })).toBe(159);
    expect(reviewDeckRemaining({ ...base, outbox: [{ reviewItemId: "a", state: "retry_wait", updatedAt: after }] })).toBe(159);
    expect(reviewDeckRemaining({ ...base, outbox: [{ reviewItemId: "a", state: "acknowledged", updatedAt: after }] })).toBe(159);
  });

  it("does not subtract a decision acknowledged before the count's read started", () => {
    expect(reviewDeckRemaining({ ...base, serverOpenCount: 159, outbox: [{ reviewItemId: "a", state: "acknowledged", updatedAt: before }] })).toBe(159);
  });

  it("counts separate queued and saving decisions separately", () => {
    expect(reviewDeckRemaining({ ...base, localItemIds: ["b"], outbox: [{ reviewItemId: "a", state: "retry_wait", updatedAt: after }] })).toBe(158);
  });

  it("follows items resolved or added elsewhere and never drops below the cards loaded", () => {
    expect(reviewDeckRemaining({ ...base, serverOpenCount: 140, outbox: [{ reviewItemId: "a", state: "pending", updatedAt: after }] })).toBe(139);
    expect(reviewDeckRemaining({ ...base, serverOpenCount: 180 })).toBe(180);
    expect(reviewDeckRemaining({ ...base, serverOpenCount: 40 })).toBe(56);
  });
});
