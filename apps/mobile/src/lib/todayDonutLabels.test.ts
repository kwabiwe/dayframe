import { describe, expect, it } from "vitest";
import { layoutTodayDonutLabels } from "./todayDonutLabels";
import { polarPoint, prepareDonutArcs } from "./donutGeometry";

describe("layoutTodayDonutLabels", () => {
  it("anchors to the actual ordered slice midpoint and resolves same-side collisions within the canvas", () => {
    const candidates = [1, 1, 1, 20].map((valueMs, index) => ({ id: String(index), title: "Title", valueMs, provisional: false }));
    const labels = layoutTodayDonutLabels({ availableWidth: 390, chartSize: 184, candidates, measuredWidths: {}, rowHeight: 44 });
    const arcs = prepareDonutArcs(candidates.map((item) => ({ id: item.id, value: item.valueMs })));
    for (const label of labels) {
      const arc = arcs.find((item) => item.id === label.id)!;
      expect(label.anchor).toEqual(polarPoint(195, 92, 84, (arc.startAngle + arc.endAngle) / 2));
      expect(label.side).toBe(label.anchor.x < 195 ? "left" : "right");
      const points = label.connector.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect(points[1]).toBe(points[3]);
      expect(Math.abs(points[2] - points[0])).toBeCloseTo(8);
      expect(Math.hypot(points[0] - 195, points[1] - 92)).toBeGreaterThan(84);
      expect(label.y).toBeGreaterThanOrEqual(0);
      expect(label.y + label.height).toBeLessThanOrEqual(184);
    }
    for (const side of ["left", "right"]) {
      const group = labels.filter((label) => label.side === side).sort((a, b) => a.y - b.y);
      for (let i = 1; i < group.length; i++) expect(group[i].y).toBeGreaterThanOrEqual(group[i - 1].y + group[i - 1].height);
    }
    expect(labels.length).toBeLessThan(candidates.length);
    expect(labels.some((label) => label.id === "3")).toBe(true);
  });

  it("omits a label whose measured complete duration cannot fit rather than clipping it", () => {
    expect(layoutTodayDonutLabels({ availableWidth: 300, chartSize: 184,
      candidates: [{ id: "long", title: "Long", valueMs: 100, provisional: false }],
      measuredWidths: {}, durationWidths: { long: 90 } })).toEqual([]);
  });
  it("uses at most the four largest positive source IDs with stable ties", () => {
    const labels = layoutTodayDonutLabels({
      availableWidth: 390,
      chartSize: 184,
      candidates: [
        { id: "b", title: "B", valueMs: 100, provisional: true },
        { id: "a", title: "A", valueMs: 100, provisional: true },
        { id: "c", title: "C", valueMs: 90, provisional: false },
        { id: "d", title: "D", valueMs: 80, provisional: false },
        { id: "e", title: "E", valueMs: 70, provisional: false },
        { id: "zero", title: "Zero", valueMs: 0, provisional: true }
      ],
      measuredWidths: { a: 48, b: 48, c: 48, d: 48, e: 48 }
    });

    expect(labels.length).toBeLessThanOrEqual(4);
    expect(labels.map((label) => label.id)).toEqual(expect.arrayContaining(["a", "b"]));
    expect(labels.every((label) => label.width <= 87)).toBe(true);
  });

  it("reduces labels on narrow layouts instead of creating overlap", () => {
    const labels = layoutTodayDonutLabels({
      availableWidth: 300,
      chartSize: 184,
      candidates: [
        { id: "a", title: "A", valueMs: 10, provisional: false },
        { id: "b", title: "B", valueMs: 9, provisional: true },
        { id: "c", title: "C", valueMs: 8, provisional: false }
      ],
      measuredWidths: { a: 80, b: 80, c: 80 }
    });

    expect(labels).toHaveLength(2);
    expect(labels[0].side).not.toBe(labels[1].side);
    expect(labels.every((label) => label.x >= 0 && label.x + label.width <= 300)).toBe(true);
  });
});
