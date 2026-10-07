import { describe, expect, it } from "vitest";
import { buildTodayRibbon, ribbonHitAt, ribbonSpokenBlock, ribbonTip } from "./todayRibbon";

const day = new Date(2026, 9, 7).getTime();
const at = (h: number, m = 0) => day + (h * 60 + m) * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const entry = (id: string, from: number, to: number | null, extra: Record<string, unknown> = {}) => ({
  id, startedAt: iso(from), stoppedAt: to === null ? null : iso(to), description: "Deep work", categoryId: "focus", categoryName: "Focus", categoryColor: "blue", ...extra,
}) as never;
const pending = (key: string, from: number, to: number, awaitingDecision = true) => ({
  presentationKey: key, awaitingDecision, title: "Walk", category: { id: "walk", name: "Walk", color: "lime" },
  interval: { startMs: from, endMs: to }, clippedInterval: { startMs: from, endMs: to },
}) as never;

describe("today ribbon", () => {
  it("places logged and waiting time on the day, waiting first, with the now line", () => {
    const model = buildTodayRibbon({
      entries: [entry("a", at(6), at(12)), entry("live", at(14), null)],
      pending: [pending("p", at(12), at(13)), pending("done", at(9), at(10), false)],
      nowMs: at(18),
    });
    expect(model.now).toBe(0.75);
    expect(model.blocks.map((block) => [block.key, block.left, block.width, block.live])).toEqual([
      ["pending:p", 0.5, 1 / 24, false],
      ["entry:a", 0.25, 0.25, false],
      ["entry:live", 14 / 24, 4 / 24, true],
    ]);
  });

  it("clips an overnight entry to today and ignores future and other-day time", () => {
    const model = buildTodayRibbon({
      entries: [entry("sleep", at(-2), at(6)), entry("yesterday", at(-5), at(-3)), entry("future", at(20), at(21))],
      pending: [],
      nowMs: at(9),
    });
    expect(model.blocks.map((block) => [block.key, block.left, block.width])).toEqual([["entry:sleep", 0, 0.25]]);
  });

  it("hits the logged block over waiting time, the later of overlapping blocks, and gaps", () => {
    const model = buildTodayRibbon({
      entries: [entry("a", at(8), at(12)), entry("b", at(10), at(11), { description: "Call" })],
      pending: [pending("p", at(7), at(9))],
      nowMs: at(15),
    });
    const keyAt = (h: number) => {
      const hit = ribbonHitAt(model, h / 24);
      return hit.kind === "block" ? hit.block.key : "gap";
    };
    expect(keyAt(7.5)).toBe("pending:p");
    expect(keyAt(8.5)).toBe("entry:a");
    expect(keyAt(10.5)).toBe("entry:b");
    expect(keyAt(13)).toBe("gap");
    expect(ribbonHitAt(model, -1).atMs).toBe(day);
  });

  it("writes the scrub tooltip and the VoiceOver line", () => {
    const model = buildTodayRibbon({
      entries: [entry("a", at(8, 13), at(10)), entry("live", at(14), null)],
      pending: [pending("p", at(12), at(12, 40))],
      nowMs: at(15),
    });
    expect(ribbonTip(ribbonHitAt(model, 9 / 24))).toEqual({ title: "Deep work", detail: "08:13–10:00 · 1h 47m" });
    expect(ribbonTip(ribbonHitAt(model, 12.5 / 24))).toEqual({ title: "Walk", detail: "12:00–12:40 · 40m · needs review" });
    expect(ribbonTip(ribbonHitAt(model, 14.5 / 24))).toEqual({ title: "Deep work", detail: "14:00–now · 1h" });
    expect(ribbonTip(ribbonHitAt(model, 11 / 24))).toEqual({ title: "11:00", detail: "Untracked" });
    expect(ribbonSpokenBlock(model.blocks[0])).toBe("Walk, 12:00 to 12:40, 40 minutes, needs review");
    expect(ribbonSpokenBlock(model.blocks[1])).toBe("Deep work, 08:13 to 10:00, 1 hour 47 minutes");
  });
});
