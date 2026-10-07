import { describe, expect, it } from "vitest";
import {
  QUICK_START_MOSAIC,
  lastSevenDaysStart,
  layoutQuickStartMosaic,
  quickStartTileFrames,
  rankQuickStartActivities,
  weeklySecondsByActivity,
  type QuickStartActivity,
} from "./quickStartMosaic";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const HOUR = 3600;

function activity(id: string, weekSeconds = 0): QuickStartActivity {
  return { color: "blue", icon: null, id, name: id, weekSeconds };
}

describe("weeklySecondsByActivity", () => {
  it("adds completed time from local midnight six days ago and clips entries that started earlier", () => {
    const windowStart = lastSevenDaysStart(NOW);
    const iso = (ms: number) => new Date(ms).toISOString();
    const totals = weeklySecondsByActivity(
      [
        { categoryId: "work", startedAt: iso(NOW - 3 * HOUR * 1000), stoppedAt: iso(NOW - HOUR * 1000) },
        { categoryId: "work", startedAt: iso(windowStart - HOUR * 1000), stoppedAt: iso(windowStart + HOUR * 1000) },
        { categoryId: "gym", startedAt: iso(windowStart - 3 * HOUR * 1000), stoppedAt: iso(windowStart - 2 * HOUR * 1000) },
        { categoryId: null, startedAt: iso(NOW - HOUR * 1000), stoppedAt: iso(NOW - 1800 * 1000) },
      ],
      NOW
    );
    expect(totals.get("work")).toBe(3 * HOUR);
    expect(totals.has("gym")).toBe(false);
    expect(totals.size).toBe(1);
  });

  it("only moves its window at local midnight", () => {
    const start = lastSevenDaysStart(NOW);
    expect(new Date(start).getHours()).toBe(0);
    expect(lastSevenDaysStart(NOW + 60_000)).toBe(start);
    expect(Math.round((new Date(NOW).setHours(0, 0, 0, 0) - start) / 86_400_000)).toBe(6);
  });

  it("leaves the running entry out so tiles do not resize every second", () => {
    const totals = weeklySecondsByActivity(
      [{ categoryId: "work", startedAt: "2026-10-07T11:00:00.000Z", stoppedAt: null }],
      NOW
    );
    expect(totals.size).toBe(0);
  });
});

describe("rankQuickStartActivities", () => {
  it("keeps the first six pinned activities and ranks them by this week, ties in usage order", () => {
    const pinned = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ color: null, icon: null, id, name: id }));
    const ranked = rankQuickStartActivities(pinned, new Map([["c", 300], ["e", 600], ["g", 9000]]));
    expect(ranked.map((item) => item.id)).toEqual(["e", "c", "a", "b", "d", "f"]);
  });

  it("does not reorder tiles for less than a minute of tracking", () => {
    const pinned = ["a", "b", "c"].map((id) => ({ color: null, icon: null, id, name: id }));
    expect(rankQuickStartActivities(pinned, new Map([["c", 15]])).map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(rankQuickStartActivities(pinned, new Map([["c", 61], ["b", 119]])).map((item) => item.id)).toEqual(["b", "c", "a"]);
  });
});

describe("layoutQuickStartMosaic", () => {
  it("puts the busiest activity in the tall middle column for a full mosaic", () => {
    const columns = layoutQuickStartMosaic(
      ["r0", "r1", "r2", "r3", "r4", "r5"].map((id, index) => activity(id, (6 - index) * HOUR))
    );
    expect(columns.map((column) => column.tiles.map((tile) => tile.id))).toEqual([
      ["r1", "r4"],
      ["r0"],
      ["r2", "r3", "r5"],
    ]);
    expect(columns.map((column) => column.flex)).toEqual([1, 1.15, 1]);
    expect(columns[1].tiles[0].height).toBe(QUICK_START_MOSAIC.height);
  });

  it("fills every column exactly and never draws a tile below the minimum", () => {
    for (let count = 1; count <= 6; count += 1) {
      const ranked = Array.from({ length: count }, (_, index) => activity(`a${index}`, index === 0 ? 40 * HOUR : 60));
      for (const column of layoutQuickStartMosaic(ranked)) {
        const used = column.tiles.reduce((sum, tile) => sum + tile.height, 0) + QUICK_START_MOSAIC.gap * (column.tiles.length - 1);
        expect(used).toBeCloseTo(QUICK_START_MOSAIC.height, 5);
        for (const tile of column.tiles) expect(tile.height).toBeGreaterThanOrEqual(QUICK_START_MOSAIC.minTileHeight - 0.5);
      }
    }
  });

  it("shares a column evenly in a quiet week and marks short tiles compact", () => {
    const columns = layoutQuickStartMosaic(["a", "b", "c", "d", "e", "f"].map((id) => activity(id)));
    const right = columns[2].tiles.map((tile) => tile.height);
    expect(Math.max(...right) - Math.min(...right)).toBeLessThanOrEqual(1);
    expect(columns[2].tiles.every((tile) => tile.compact === tile.height < QUICK_START_MOSAIC.compactBelow)).toBe(true);
  });

  it("uses fewer columns when fewer activities are pinned", () => {
    expect(layoutQuickStartMosaic([])).toEqual([]);
    expect(layoutQuickStartMosaic([activity("only")]).map((column) => column.flex)).toEqual([1]);
    expect(layoutQuickStartMosaic([activity("a", 2), activity("b", 1)]).map((column) => column.tiles[0].id)).toEqual(["a", "b"]);
  });

  it("frames tiles by activity: widths and gaps fill the container and a rank change keeps each id", () => {
    const before = layoutQuickStartMosaic(["a", "b", "c", "d", "e", "f"].map((id, index) => activity(id, (6 - index) * HOUR)));
    const frames = quickStartTileFrames(before, 343);
    const columnsX = [...new Set(frames.map((frame) => frame.x))];
    const right = Math.max(...frames.map((frame) => frame.x + frame.width));
    expect(columnsX).toHaveLength(3);
    expect(right).toBeCloseTo(343, 5);
    const after = layoutQuickStartMosaic(["c", "a", "b", "d", "e", "f"].map((id, index) => activity(id, (6 - index) * HOUR)));
    expect(quickStartTileFrames(after, 343).map((frame) => frame.id).sort()).toEqual(frames.map((frame) => frame.id).sort());
    expect(quickStartTileFrames(after, 343).find((frame) => frame.id === "c")!.x).not.toBe(frames.find((frame) => frame.id === "c")!.x);
  });
});
