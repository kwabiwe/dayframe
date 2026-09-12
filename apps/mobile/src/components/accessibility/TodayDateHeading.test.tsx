import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ Text: "Text", View: "View" }));
import { TodayDateHeading } from "./TodayDateHeading";

describe("TodayDateHeading", () => {
  it("renders the actual Today/date presentation with the scoped native roles", () => {
    const frames: string[] = [];
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<TodayDateHeading
        dateLabel="Saturday, 12 September 2026"
        styles={{ todayHeading: { gap: 2 }, todayTitle: { fontSize: 28 }, todaySubtitle: { fontSize: 13 } } as never}
        diagnostic={{ onLayout: (id) => frames.push(id) }}
      />);
    });
    const texts = tree.root.findAllByType("Text" as never);
    expect(texts.map((text) => text.children.join(""))).toEqual([
      "Today",
      "Saturday, 12 September 2026",
    ]);
    expect(texts.map((text) => text.props.maxFontSizeMultiplier)).toEqual([1.5, 1.3]);
    expect(texts.every((text) => text.props.allowFontScaling)).toBe(true);
    act(() => tree.root.findByType("View" as never).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 66 } } }));
    expect(frames).toEqual(["today.heading"]);
    act(() => tree.unmount());
  });
});
