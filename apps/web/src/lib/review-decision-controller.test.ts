import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REVIEW_DECISION_UNDO_MS,
  ReviewDecisionController,
  type ReviewDecisionCommitResult,
  type ReviewDecisionRequest,
  type ReviewDecisionState
} from "@/lib/review-decision-controller";

afterEach(() => vi.useRealTimers());

function request(itemId: string, kind: "log" | "skip" = "log"): ReviewDecisionRequest {
  return {
    itemId,
    kind,
    mutation: kind === "log" ? { action: "accept" } : { action: "ignore_once" },
    signature: `sig-${itemId}`,
    label: `${kind === "log" ? "Logged" : "Skipped"} ${itemId}`,
    durationMs: 60_000,
    color: "mint",
    colorName: "Exercise"
  };
}

function setup(results: Array<ReviewDecisionCommitResult | Error> = []) {
  vi.useFakeTimers();
  let state: ReviewDecisionState | null = null;
  const commits: Array<{ itemId: string; keepalive: boolean; clientMutationId: string }> = [];
  let id = 0;
  const controller = new ReviewDecisionController((next) => { state = next; }, () => `id-${++id}`);
  controller.setCommit(async (decision, options) => {
    commits.push({ itemId: decision.itemId, keepalive: options.keepalive, clientMutationId: decision.clientMutationId });
    const result = results.shift() ?? "saved";
    if (result instanceof Error) throw result;
    return result;
  });
  return { controller, commits, state: () => state! };
}

describe("ReviewDecisionController", () => {
  it("holds a decision for Undo and sends nothing until the window ends", async () => {
    const { controller, commits, state } = setup();
    expect(controller.decide(request("a"))).toBe(true);
    expect(state().hiddenIds.has("a")).toBe(true);
    expect(state().notice?.label).toBe("Logged a");
    await vi.advanceTimersByTimeAsync(REVIEW_DECISION_UNDO_MS - 1);
    expect(commits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(commits).toEqual([{ itemId: "a", keepalive: false, clientMutationId: "id-1" }]);
    expect(state().notice?.isExiting).toBe(true);
    // Saved: hidden until fresh data drops it, and still this visit's for "All framed".
    controller.reconcileItemIds(new Set(["a"]));
    expect(state().hiddenIds.has("a")).toBe(true);
    controller.reconcileItemIds(new Set());
    expect(state().hiddenIds.has("a")).toBe(false);
    expect(state().decided.map((decision) => decision.itemId)).toEqual(["a"]);
  });

  it("Undo brings the card back and never sends", async () => {
    const { controller, commits, state } = setup();
    controller.decide(request("a"));
    controller.undo();
    expect(state().hiddenIds.has("a")).toBe(false);
    expect(state().decided).toEqual([]);
    expect(state().restored?.itemId).toBe("a");
    await vi.advanceTimersByTimeAsync(REVIEW_DECISION_UNDO_MS * 2);
    expect(commits).toEqual([]);
    expect(state().notice).toBeNull();
  });

  it("saves the held decision first when another is made, one toast at a time", async () => {
    const { controller, commits, state } = setup();
    controller.decide(request("a"));
    controller.decide(request("b", "skip"));
    await vi.advanceTimersByTimeAsync(0);
    expect(commits.map((commit) => commit.itemId)).toEqual(["a"]);
    expect(state().notice?.label).toBe("Skipped b");
    controller.undo();
    expect(state().hiddenIds.has("a")).toBe(true);
    expect(state().hiddenIds.has("b")).toBe(false);
  });

  it("refuses a second decision for an item already held or saving", async () => {
    const { controller } = setup();
    expect(controller.decide(request("a"))).toBe(true);
    expect(controller.decide(request("a", "skip"))).toBe(false);
  });

  it("brings the card back with an alert when the save fails", async () => {
    const { controller, state } = setup([new Error("Server unavailable.")]);
    controller.decide(request("a"));
    await vi.advanceTimersByTimeAsync(REVIEW_DECISION_UNDO_MS);
    expect(state().hiddenIds.has("a")).toBe(false);
    expect(state().decided).toEqual([]);
    expect(state().error).toBe("Server unavailable. It’s back in the queue.");
    expect(state().restored?.itemId).toBe("a");
  });

  it("saves nothing for a suggestion that changed while held", async () => {
    const { controller, state } = setup(["changed"]);
    controller.decide(request("a"));
    await vi.advanceTimersByTimeAsync(REVIEW_DECISION_UNDO_MS);
    expect(state().hiddenIds.has("a")).toBe(false);
    expect(state().error).toBe("“a” changed, so it was not saved. Review it again.");
  });

  it("drops a decision quietly when the item was decided elsewhere", async () => {
    const { controller, state } = setup(["gone"]);
    controller.decide(request("a"));
    await vi.advanceTimersByTimeAsync(REVIEW_DECISION_UNDO_MS);
    expect(state().decided).toEqual([]);
    expect(state().error).toBeNull();
  });

  it("flush saves the held decision at once with keepalive (leaving the page)", async () => {
    const { controller, commits } = setup();
    controller.decide(request("a"));
    controller.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(commits).toEqual([{ itemId: "a", keepalive: true, clientMutationId: "id-1" }]);
    controller.undo();
    await vi.advanceTimersByTimeAsync(REVIEW_DECISION_UNDO_MS);
    expect(commits).toHaveLength(1);
  });
});
