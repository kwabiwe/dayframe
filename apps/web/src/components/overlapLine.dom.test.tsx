// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverlapLine } from "./OverlapNotice";

const at = (hour: number, minute = 0) => new Date(2026, 9, 11, hour, minute).toISOString();
const work = { id: "w", startedAt: at(9), stoppedAt: at(10), categoryName: "Work", description: "Planning" };
const gym = { id: "g", startedAt: at(9, 30), stoppedAt: at(11), categoryName: "Gym", description: null };
const block = { startedAt: at(9, 50), stoppedAt: at(11, 50) };

describe("Review card overlap line (Trello: web Review overlap)", () => {
  it("says which activity it overlaps and by how much, in one quiet line", () => {
    const html = renderToStaticMarkup(<OverlapLine candidate={block} entries={[work]} nowMs={Date.parse(at(18))} />);
    expect(html).toContain("Overlaps Work by 10m");
    expect(html).toContain('class="df-roverlap df-tnum"');
    expect(html).not.toMatch(/Time covered|This is allowed|<aside/);
  });

  it("counts the other overlapped blocks and adds a cue only when the overlap is most of the block", () => {
    const short = { startedAt: at(9, 45), stoppedAt: at(10, 15) };
    const html = renderToStaticMarkup(<OverlapLine candidate={short} entries={[work, gym]} nowMs={Date.parse(at(18))} />);
    // Named by the largest overlap: Gym shares 30m, Work 15m.
    expect(html).toContain("Overlaps Gym and 1 more by 30m");
    expect(html).toContain("is-large");
    expect(html).toContain("most of this block");
  });

  it("renders nothing without an overlap", () => {
    expect(renderToStaticMarkup(<OverlapLine candidate={{ startedAt: at(12), stoppedAt: at(13) }} entries={[work]} nowMs={Date.parse(at(18))} />)).toBe("");
  });

  it("needs strictly more than half the block, measured exactly, for the stronger cue", () => {
    const half = renderToStaticMarkup(<OverlapLine candidate={{ startedAt: at(9, 55), stoppedAt: at(10, 5) }} entries={[work]} nowMs={Date.parse(at(18))} />);
    expect(half).toContain("Overlaps Work by 5m");
    expect(half).not.toContain("is-large");
    // 60.75 s of a 121 s block is more than half, even though whole seconds would round it down.
    const base = Date.parse(at(9, 59));
    const block = { startedAt: new Date(base).toISOString(), stoppedAt: new Date(base + 121_000).toISOString() };
    const peer = { id: "p", startedAt: new Date(base + 60_250).toISOString(), stoppedAt: new Date(base + 200_000).toISOString(), categoryName: "Call" };
    expect(renderToStaticMarkup(<OverlapLine candidate={block} entries={[peer]} nowMs={Date.parse(at(18))} />)).toContain("is-large");
  });

  it("uses the given clock for running blocks, so the same props always say the same thing", () => {
    const running = { id: "r", startedAt: at(10), stoppedAt: null, categoryName: "Gym" };
    const block = { startedAt: at(9, 50), stoppedAt: at(10, 30) };
    const early = renderToStaticMarkup(<OverlapLine candidate={block} entries={[running]} nowMs={Date.parse(at(10, 10))} />);
    expect(early).toContain("Overlaps Gym by 10m");
    expect(early).not.toContain("is-large");
    expect(renderToStaticMarkup(<OverlapLine candidate={block} entries={[running]} nowMs={Date.parse(at(10, 10))} />)).toBe(early);
  });
});
