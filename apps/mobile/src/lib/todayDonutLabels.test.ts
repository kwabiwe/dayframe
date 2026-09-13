import { describe, expect, it } from "vitest";
import { layoutTodayDonutLabels } from "./todayDonutLabels";

describe("layoutTodayDonutLabels", () => {
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

    expect(labels.map((label) => label.id)).toEqual(["a", "b", "c", "d"]);
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
