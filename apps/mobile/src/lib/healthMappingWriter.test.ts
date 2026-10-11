import { describe, expect, it, vi } from "vitest";
import type { HealthAutoLogMapping, HealthAutoLogMappings, HealthImportPreferenceKey } from "@dayframe/shared";
import { createHealthMappingWriter } from "./healthMappingWriter";

/** A fake mapping store whose writes can be held open, failed, or let through. */
function setup(initial: HealthAutoLogMappings = {}) {
  let stored: HealthAutoLogMappings = initial;
  const writes: { type: HealthImportPreferenceKey; mapping: HealthAutoLogMapping }[] = [];
  const holds: Array<{ release: () => void; fail: () => void }> = [];
  let holdNext = 0;
  let failNext = 0;
  const shown: HealthAutoLogMappings[] = [];
  const settled = vi.fn();
  const failed = vi.fn();
  const writer = createHealthMappingWriter({
    readSaved: async () => stored,
    write: async (type, mapping) => {
      writes.push({ type, mapping });
      if (holdNext > 0) {
        holdNext -= 1;
        await new Promise<void>((release, reject) => holds.push({ release, fail: () => reject(new Error("offline")) }));
      } else if (failNext > 0) {
        failNext -= 1;
        throw new Error("offline");
      }
      const next = { ...stored };
      if (mapping.categoryId || mapping.description) next[type] = mapping;
      else delete next[type];
      stored = next;
      return stored;
    },
    show: (mappings) => shown.push(mappings),
    settled,
    failed
  });
  return {
    writer,
    writes,
    holds,
    shown,
    settled,
    failed,
    hold: (count = 1) => { holdNext += count; },
    failOnce: () => { failNext += 1; },
    stored: () => stored,
    lastShown: () => shown[shown.length - 1]
  };
}

const tick = () => new Promise((done) => setTimeout(done, 0));

describe("Health mapping writer (UIA-085)", () => {
  it("writes a changed Name once and skips an unchanged one", async () => {
    const t = setup({ walking: { description: "Old" } });
    await t.writer.commitName("walking", "New");
    await t.writer.commitName("walking", "New ");
    expect(t.writes).toEqual([{ type: "walking", mapping: { description: "New" } }]);
    expect(t.settled).toHaveBeenCalledTimes(1);
  });

  it("a failed Name puts the saved Name back in the sheet and can be tried again", async () => {
    const t = setup({ walking: { description: "Old" } });
    const restore = vi.fn();
    t.failOnce();
    expect(await t.writer.commitName("walking", "New", restore)).toBe(false);
    expect(restore).toHaveBeenCalledWith("Old", "New");
    expect(t.lastShown().walking).toEqual({ description: "Old" });
    expect(await t.writer.commitName("walking", "New", restore)).toBe(true);
    expect(t.stored().walking).toEqual({ description: "New" });
  });

  it("the newest committed Name wins while an earlier one is on its way, including a return to the saved Name", async () => {
    const t = setup({ walking: { description: "Old" } });
    t.hold();
    const first = t.writer.commitName("walking", "New");
    await tick();
    const back = t.writer.commitName("walking", "Old");
    t.holds[0].release();
    await first;
    await back;
    expect(t.writes.map((w) => w.mapping.description)).toEqual(["New", "Old"]);
    expect(t.stored().walking).toEqual({ description: "Old" });
  });

  it("Codex r5 (1): a reopened sheet's Name lands even when it matches the first sheet's original", async () => {
    // Blur A while writes are pending → type B, close → reopen → blur C → type A, close.
    const t = setup({ walking: { description: "Orig" } });
    t.hold();
    void t.writer.commitName("walking", "A");
    await tick();
    void t.writer.commitName("walking", "B");
    void t.writer.commitName("walking", "C");
    const last = t.writer.commitName("walking", "A");
    t.holds[0].release();
    await last;
    await t.writer.idle("walking");
    expect(t.stored().walking).toEqual({ description: "A" });
    expect(t.lastShown().walking).toEqual({ description: "A" });
  });

  it("Codex r5 (2): a dismissed sheet's queued Name never undoes a later Use default", async () => {
    const t = setup({ walking: { categoryId: "cat-1" } });
    t.hold();
    void t.writer.patch("walking", { categoryId: "cat-2" });
    await tick();
    // The sheet closes with a Name, then Use default is tapped in a new sheet.
    void t.writer.commitName("walking", "Evening walk");
    const reset = t.writer.patch("walking", { categoryId: null });
    t.holds[0].release();
    expect(await reset).toBe(true);
    await t.writer.idle("walking");
    expect(t.stored().walking).toEqual({ categoryId: null, description: "Evening walk" });
  });

  it("each change merges into the saved mapping when it runs, in the order made", async () => {
    const t = setup({});
    t.hold();
    void t.writer.patch("walking", { categoryId: "cat-1" });
    await tick();
    void t.writer.commitName("walking", "Walk");
    void t.writer.patch("walking", { categoryId: "cat-2" });
    // Shown straight away: saved with every queued change laid over it.
    await tick();
    expect(t.lastShown().walking).toEqual({ categoryId: "cat-2", description: "Walk" });
    t.holds[0].release();
    await t.writer.idle("walking");
    expect(t.writes.map((w) => w.mapping)).toEqual([
      { categoryId: "cat-1" },
      { categoryId: "cat-1", description: "Walk" },
      { categoryId: "cat-2", description: "Walk" }
    ]);
    expect(t.settled).toHaveBeenCalledTimes(1);
  });

  it("a failed change drops out of what is shown without losing changes still queued", async () => {
    const t = setup({ walking: { categoryId: "cat-1" } });
    t.hold();
    const failing = t.writer.patch("walking", { categoryId: "cat-2" });
    await tick();
    void t.writer.commitName("walking", "Walk");
    t.holds[0].fail();
    expect(await failing).toBe(false);
    expect(t.failed).toHaveBeenCalledTimes(1);
    expect(t.shown.some((m) => m.walking?.categoryId === "cat-1" && m.walking?.description === "Walk")).toBe(true);
    await t.writer.idle("walking");
    expect(t.stored().walking).toEqual({ categoryId: "cat-1", description: "Walk" });
  });

  it("keeps newer typing when an earlier Name fails", async () => {
    const t = setup({ walking: { description: "Old" } });
    let sheetDraft = "New";
    const restore = (saved: string, failedName: string) => {
      if (sheetDraft.trim() === failedName) sheetDraft = saved;
    };
    t.hold();
    const first = t.writer.commitName("walking", sheetDraft, restore);
    await tick();
    sheetDraft = "Newer";
    t.holds[0].fail();
    await first;
    expect(sheetDraft).toBe("Newer");
  });

  it("types queue separately", async () => {
    const t = setup({});
    t.hold();
    void t.writer.patch("walking", { categoryId: "cat-1" });
    await tick();
    await t.writer.patch("running", { categoryId: "cat-2" });
    expect(t.stored().running).toEqual({ categoryId: "cat-2" });
    t.holds[0].release();
    await t.writer.idle("walking");
  });
});
