import { describe, expect, it } from "vitest";
import { layoutCalendarColumns, type CalendarColumnInput } from "./calendarColumns";

const minute = 60_000;
const block = (id: string, startMinute: number, endMinute: number): CalendarColumnInput => ({
  id,
  startMs: startMinute * minute,
  endMs: endMinute * minute
});
const columns = (input: CalendarColumnInput[]) =>
  Object.fromEntries(layoutCalendarColumns(input).map((layout) => [layout.id, [layout.columnIndex, layout.columnCount]]));

describe("layoutCalendarColumns (Trello 210)", () => {
  it("keeps a block that collides with nothing full width", () => {
    expect(layoutCalendarColumns([block("a", 60, 120)])).toEqual([{
      id: "a", clusterId: "a", columnIndex: 0, columnCount: 1, offsetFraction: 0, widthFraction: 1, zIndex: 0
    }]);
  });

  it("splits an overlap cluster evenly, longer block first on a shared start", () => {
    const layouts = layoutCalendarColumns([block("short", 420, 425), block("long", 420, 480)]);
    expect(layouts).toEqual([
      { id: "long", clusterId: "long:short", columnIndex: 0, columnCount: 2, offsetFraction: 0, widthFraction: 0.5, zIndex: 1 },
      { id: "short", clusterId: "long:short", columnIndex: 1, columnCount: 2, offsetFraction: 0.5, widthFraction: 0.5, zIndex: 2 }
    ]);
  });

  it("gives nested blocks a column each", () => {
    expect(columns([block("outer", 540, 720), block("middle", 570, 660), block("inner", 600, 630)]))
      .toEqual({ outer: [0, 3], middle: [1, 3], inner: [2, 3] });
  });

  it("treats a chain as one cluster and reuses a column once its block has ended", () => {
    expect(columns([block("a", 540, 600), block("b", 570, 660), block("c", 630, 720), block("d", 700, 760)]))
      .toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [1, 2] });
  });

  it("keeps separate clusters independent", () => {
    expect(columns([block("a", 540, 600), block("b", 550, 560), block("c", 900, 960)]))
      .toEqual({ a: [0, 2], b: [1, 2], c: [0, 1] });
  });

  it("collides a contained block of any length, but not a sub-minute brush or back-to-back blocks", () => {
    const contained = layoutCalendarColumns([
      { id: "long", startMs: 0, endMs: 60 * minute },
      { id: "blip", startMs: 10 * minute, endMs: 10 * minute + 30_000 }
    ]);
    expect(contained.map((layout) => layout.columnCount)).toEqual([2, 2]);
    expect(columns([
      { id: "a", startMs: 0, endMs: 30 * minute + 30_000 },
      { id: "b", startMs: 30 * minute, endMs: 60 * minute },
      block("c", 60, 62),
      block("d", 62, 90)
    ])).toEqual({ a: [0, 1], b: [0, 1], c: [0, 1], d: [0, 1] });
  });

  it("collides two identical short blocks", () => {
    expect(columns([
      { id: "x", startMs: 0, endMs: 20_000 },
      { id: "y", startMs: 0, endMs: 20_000 }
    ])).toEqual({ x: [0, 2], y: [1, 2] });
  });

  it("is deterministic whatever the input order and ignores duplicate or invalid blocks", () => {
    const input = [block("a", 540, 600), block("b", 570, 660), block("c", 600, 630), block("a", 0, 10), { id: "bad", startMs: Number.NaN, endMs: 5 }];
    const forward = layoutCalendarColumns(input);
    const backward = layoutCalendarColumns([...input].reverse().filter((item) => item.startMs !== 0));
    const byId = (layouts: ReturnType<typeof layoutCalendarColumns>) => [...layouts].sort((left, right) => left.id.localeCompare(right.id));
    expect(byId(forward)).toEqual(byId(backward));
    expect(forward.map((layout) => layout.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("never leaves two colliding blocks in the same horizontal space", () => {
    // A pseudo-random day of short and long blocks.
    let seed = 7;
    const random = () => (seed = (seed * 48_271) % 2_147_483_647) / 2_147_483_647;
    const input = Array.from({ length: 40 }, (_, index) => {
      const start = Math.floor(random() * 1_380);
      return block(`b${index}`, start, start + 1 + Math.floor(random() * (random() < 0.5 ? 10 : 120)));
    });
    const layouts = new Map(layoutCalendarColumns(input).map((layout) => [layout.id, layout]));
    for (const [index, left] of input.entries()) {
      for (const right of input.slice(index + 1)) {
        const overlapMs = Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs);
        if (overlapMs <= 0) continue;
        const a = layouts.get(left.id)!;
        const b = layouts.get(right.id)!;
        if (a.clusterId !== b.clusterId) continue;
        expect(a.columnIndex, `${left.id} and ${right.id}`).not.toBe(b.columnIndex);
        expect(a.offsetFraction + a.widthFraction <= b.offsetFraction + 1e-9 || b.offsetFraction + b.widthFraction <= a.offsetFraction + 1e-9).toBe(true);
      }
    }
  });
});
