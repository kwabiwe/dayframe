import { describe, expect, it } from "vitest";
import { runReviewBulkSkip, type ReviewBulkSkipEntry } from "./reviewBulkSkip";

type Item = { id: string; startedAt: string };

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function setup(ids: string[]) {
  const items = new Map<string, Item>(ids.map((id) => [id, { id, startedAt: "old" }]));
  const entries: ReviewBulkSkipEntry[] = ids.map((id) => ({ key: `review:${id}`, itemId: id, proposal: "old" }));
  const writes: string[] = [];
  const pending: ReturnType<typeof deferred>[] = [];
  const state = { owner: "a", saving: new Set<string>() };
  const run = runReviewBulkSkip<Item>(entries, {
    enqueue: (item) => {
      writes.push(item.id);
      const next = deferred();
      pending.push(next);
      return next.promise;
    },
    isSaving: (id) => state.saving.has(id),
    openItem: (id) => items.get(id),
    ownerMatches: () => state.owner === "a",
    signature: (item) => item.startedAt
  });
  // Lets the runner reach its next await.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { items, pending, run, state, tick, writes };
}

const ids = (entries: ReviewBulkSkipEntry[]) => entries.map((entry) => entry.itemId);

describe("runReviewBulkSkip", () => {
  it("writes each moment in turn and reports them saved", async () => {
    const { pending, run, tick, writes } = setup(["a", "b"]);
    await tick();
    expect(writes).toEqual(["a"]);
    pending[0].resolve();
    await tick();
    expect(writes).toEqual(["a", "b"]);
    pending[1].resolve();
    expect(ids((await run).saved)).toEqual(["a", "b"]);
  });

  it("re-checks a later moment right before writing it (a refresh changed it meanwhile)", async () => {
    const { items, pending, run, tick, writes } = setup(["a", "b", "c"]);
    await tick();
    items.set("b", { id: "b", startedAt: "this week" });
    items.delete("c");
    pending[0].resolve();
    const outcome = await run;
    expect(writes).toEqual(["a"]);
    expect(ids(outcome.saved)).toEqual(["a"]);
    expect(ids(outcome.changed)).toEqual(["b"]);
    expect(ids(outcome.resolved)).toEqual(["c"]);
  });

  it("leaves a moment another change is saving", async () => {
    const { pending, run, state, tick } = setup(["a", "b"]);
    await tick();
    state.saving.add("b");
    pending[0].resolve();
    expect(ids((await run).changed)).toEqual(["b"]);
  });

  it("stops writing once the account changes, and nothing is put back", async () => {
    const { pending, run, state, tick, writes } = setup(["a", "b", "c"]);
    await tick();
    state.owner = "b";
    pending[0].resolve();
    const outcome = await run;
    expect(writes).toEqual(["a"]);
    expect(ids(outcome.saved)).toEqual(["a"]);
    expect(ids(outcome.abandoned)).toEqual(["b", "c"]);
    expect(outcome.failed).toEqual([]);
  });

  it("reports a failed local save, and carries on with the rest", async () => {
    const { pending, run, tick } = setup(["a", "b"]);
    await tick();
    pending[0].reject(new Error("disk full"));
    await tick();
    pending[1].resolve();
    const outcome = await run;
    expect(ids(outcome.failed)).toEqual(["a"]);
    expect(ids(outcome.saved)).toEqual(["b"]);
  });

  it("counts a write rejected because the account changed as abandoned, not failed", async () => {
    const { pending, run, state, tick } = setup(["a"]);
    await tick();
    state.owner = "b";
    pending[0].reject(new Error("Review data is not configured for this account."));
    const outcome = await run;
    expect(ids(outcome.abandoned)).toEqual(["a"]);
    expect(outcome.failed).toEqual([]);
  });
});
