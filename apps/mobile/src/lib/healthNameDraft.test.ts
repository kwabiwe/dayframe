import { describe, expect, it, vi } from "vitest";
import { createNameCommitter } from "./healthNameDraft";

function setup(results: boolean[]) {
  let draft = "Old";
  const save = vi.fn(async () => results.shift() ?? true);
  const commit = createNameCommitter({
    key: "t1",
    initial: "Old",
    readDraft: () => draft,
    showDraft: (value) => { draft = value; },
    save
  });
  return { commit, save, type: (value: string) => { draft = value; }, draft: () => draft };
}

describe("Health type Name draft (UIA-085)", () => {
  it("saves a changed Name once, even when editing ends and the sheet closes", async () => {
    const { commit, save, type } = setup([true]);
    type("New");
    const first = commit();
    void commit();
    await first;
    await commit();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("New");
  });

  it("puts the saved Name back after a failure and lets the same Name be tried again", async () => {
    const { commit, save, type, draft } = setup([false, true]);
    type("New");
    await commit();
    expect(draft()).toBe("Old");
    type("New");
    await commit();
    expect(save).toHaveBeenCalledTimes(2);
    expect(draft()).toBe("New");
  });

  it("keeps newer typing when an earlier save fails", async () => {
    let resolve!: (ok: boolean) => void;
    let draft = "Old";
    const commit = createNameCommitter({
      key: "t2",
      initial: "Old",
      readDraft: () => draft,
      showDraft: (value) => { draft = value; },
      save: () => new Promise((done) => { resolve = done; })
    });
    draft = "New";
    const pending = commit();
    draft = "Newer";
    resolve(false);
    await pending;
    expect(draft).toBe("Newer");
  });
});

describe("Health type Name draft — latest wins (Codex r3)", () => {
  it("saves a return to the original Name typed while another save was pending", async () => {
    let resolveFirst!: (ok: boolean) => void;
    let draft = "Old";
    const saves: string[] = [];
    const commit = createNameCommitter({
      key: "t2",
      initial: "Old",
      readDraft: () => draft,
      showDraft: (value) => { draft = value; },
      save: (name) => {
        saves.push(name);
        return saves.length === 1 ? new Promise((done) => { resolveFirst = done; }) : Promise.resolve(true);
      }
    });
    draft = "New";
    const first = commit();
    draft = "Old";
    const closing = commit();
    resolveFirst(true);
    await first;
    await closing;
    expect(saves).toEqual(["New", "Old"]);
  });
});

describe("Health type Name draft — across sheets (Codex r4)", () => {
  it("queues a reopened sheet's save behind the earlier sheet's, so the newest edit lands last", async () => {
    let resolveFirst!: (ok: boolean) => void;
    const saves: string[] = [];
    const save = (name: string) => {
      saves.push(name);
      return saves.length === 1 ? new Promise<boolean>((done) => { resolveFirst = done; }) : Promise.resolve(true);
    };
    let first = "A";
    const sheet1 = createNameCommitter({ key: "walking", initial: "", readDraft: () => first, showDraft: (v) => { first = v; }, save });
    const p1 = sheet1();
    first = "B";
    void sheet1();
    let second = "C";
    const sheet2 = createNameCommitter({ key: "walking", initial: "", readDraft: () => second, showDraft: (v) => { second = v; }, save });
    const p2 = sheet2();
    resolveFirst(true);
    await p1;
    await p2;
    expect(saves).toEqual(["A", "B", "C"]);
  });
});
