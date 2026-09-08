import { describe, expect, it } from "vitest";
import { donutSlicePath, prepareDonutArcs } from "./donutGeometry";

describe("donut geometry", () => {
  it("handles empty, single, tiny, and many segments without invalid paths", () => {
    expect(prepareDonutArcs([])).toEqual([]);
    const single = prepareDonutArcs([{ id: "a", value: 1 }]);
    expect(single).toHaveLength(1);
    expect(single[0].endAngle).toBe(360);
    expect(donutSlicePath(92, 92, 84, 57, single[0].startAngle, single[0].endAngle)).not.toMatch(/NaN|Infinity/);
    const many = prepareDonutArcs(Array.from({ length: 15 }, (_, index) => ({ id: `c-${index}`, value: index === 0 ? 0.001 : index + 1 })));
    expect(many).toHaveLength(15);
    expect(many.every((arc) => arc.endAngle >= arc.startAngle)).toBe(true);
    expect(Math.max(...many.map((arc) => arc.endAngle))).toBeLessThanOrEqual(360);
  });

  it("uses stable IDs and ignores invalid or zero values", () => {
    expect(prepareDonutArcs([
      { id: "", value: 5 },
      { id: "zero", value: 0 },
      { id: "negative", value: -1 },
      { id: "valid", value: 2 }
    ]).map((arc) => arc.id)).toEqual(["valid"]);
  });
});
