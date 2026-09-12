import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  StyleSheet: { flatten: (style: unknown) => style },
  Text: "Text",
  View: "View",
}));
vi.mock("./IntrinsicTextMeasure", () => ({
  useIntrinsicTextMeasure: (samples: string[]) => ({
    widths: Object.fromEntries(samples.map((sample) => [sample, sample === "Logged" ? 50 : sample.length * 12])),
    probe: null,
  }),
}));

import { TodayLoggedSummary } from "./TodayLoggedSummary";

const styles = {
  todayTrackedRow: { testStyle: "row" },
  todayTrackedRowStacked: { testStyle: "stacked" },
  todayTrackedLabel: { fontSize: 13 },
  todayTrackedValue: { fontSize: 13 },
  reviewMetaLine: { fontSize: 11 },
} as never;

describe("TodayLoggedSummary", () => {
  it("keeps the complete numeric total, preserves optional coverage, and uses scoped roles", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<TodayLoggedSummary value="100000h" coveredValue="6h 34m covered" styles={styles} />);
    });

    const text = tree.root.findAllByType("Text" as never);
    expect(text.map((node) => node.children.join(""))).toEqual([
      "Logged",
      "100000h",
      "6h 34m covered",
    ]);
    expect(text.map((node) => node.props.maxFontSizeMultiplier)).toEqual([1.3, 1.2, 1.2]);
    expect(text.every((node) => node.props.allowFontScaling)).toBe(true);

    act(() => tree.root.findByType("View" as never).props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 160, height: 48 } },
    }));
    expect(tree.root.findByType("View" as never).props.style).toContainEqual({ testStyle: "stacked" });
    act(() => tree.unmount());
  });

  it("omits only the absent coverage note and keeps a long summary inline when the measured budget permits", () => {
    const onTextLayout = vi.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<TodayLoggedSummary value="999h 59m" styles={styles} diagnostic={{ onTextLayout }} />);
    });
    act(() => tree.root.findByType("View" as never).props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 430, height: 48 } },
    }));
    const text = tree.root.findAllByType("Text" as never);
    expect(text.map((node) => node.children.join(""))).toEqual(["Logged", "999h 59m"]);
    expect(tree.root.findByType("View" as never).props.style).not.toContainEqual({ testStyle: "stacked" });
    act(() => tree.unmount());
  });
});
