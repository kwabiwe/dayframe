import { describe, expect, it } from "vitest";
import { createReviewDeckHold, reviewDeckProposalSignature, type ReviewDeckHeldDecision } from "./reviewDeckHold";

function decision(token: number, key = `review:${token}`): ReviewDeckHeldDecision {
  return { token, key, itemId: key, logged: token % 2 === 1, direction: token % 2 === 1 ? 1 : -1, title: key, color: "#000000", seconds: 60, proposal: "[]" };
}

function harness() {
  const timers = new Map<number, () => void>();
  let next = 0;
  const committed: number[] = [];
  const changes: Array<number | null> = [];
  const hold = createReviewDeckHold({
    clearTimer: (handle) => timers.delete(handle as number),
    onChange: (held) => changes.push(held?.token ?? null),
    onCommit: (held) => committed.push(held.token),
    setTimer: (callback) => {
      next += 1;
      timers.set(next, callback);
      return next;
    }
  });
  const fire = () => [...timers.values()].forEach((callback) => callback());
  return { changes, committed, fire, hold, timers };
}

describe("review deck hold", () => {
  it("saves a held decision when the Undo window ends", () => {
    const { committed, fire, hold } = harness();
    hold.hold(decision(1));
    expect(committed).toEqual([]);
    fire();
    expect(committed).toEqual([1]);
    expect(hold.current()).toBeNull();
  });

  it("drops the decision on Undo and never saves it", () => {
    const { committed, fire, hold, timers } = harness();
    hold.hold(decision(1));
    expect(hold.undo(1)?.token).toBe(1);
    expect(timers.size).toBe(0);
    fire();
    expect(committed).toEqual([]);
  });

  it("ignores a stale Undo token", () => {
    const { hold } = harness();
    hold.hold(decision(1));
    hold.hold(decision(2));
    expect(hold.undo(1)).toBeNull();
    expect(hold.current()?.token).toBe(2);
  });

  it("saves the previous decision when another card is decided", () => {
    const { changes, committed, hold } = harness();
    hold.hold(decision(1));
    hold.hold(decision(2));
    expect(committed).toEqual([1]);
    expect(changes).toEqual([1, 2]);
  });

  it("flushes at once when Review is left", () => {
    const { committed, fire, hold } = harness();
    hold.hold(decision(3));
    hold.flush();
    expect(committed).toEqual([3]);
    fire();
    expect(committed).toEqual([3]);
    hold.flush();
    expect(committed).toEqual([3]);
  });
});

describe("reviewDeckProposalSignature", () => {
  const item = {
    title: "Walk",
    suggestedStartedAt: "2026-10-08T09:00:00.000Z",
    suggestedStoppedAt: "2026-10-08T09:30:00.000Z",
    suggestedCategoryId: "walk",
    suggestedPlaceId: null
  };

  it("is stable for the same proposal, whatever the timestamp spelling", () => {
    expect(reviewDeckProposalSignature({ ...item, suggestedStartedAt: "2026-10-08T10:00:00+01:00" }))
      .toBe(reviewDeckProposalSignature(item));
  });

  it("changes when a refresh revises the time, activity, place or name", () => {
    const original = reviewDeckProposalSignature(item);
    expect(reviewDeckProposalSignature({ ...item, suggestedStoppedAt: "2026-10-08T11:30:00.000Z" })).not.toBe(original);
    expect(reviewDeckProposalSignature({ ...item, suggestedCategoryId: "run" })).not.toBe(original);
    expect(reviewDeckProposalSignature({ ...item, suggestedPlaceId: "park" })).not.toBe(original);
    expect(reviewDeckProposalSignature({ ...item, title: "Run" })).not.toBe(original);
  });
});
