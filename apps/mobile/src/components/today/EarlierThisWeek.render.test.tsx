import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "Text",
  View: "View",
}));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path", Rect: "Rect" }));

import type { EarlierDay } from "../../lib/earlierThisWeek";
import { EarlierThisWeek } from "./EarlierThisWeek";

const theme = { mode: "dark", surface: "#151B26", surfaceMuted: "#202838", textMuted: "#707B91", textPrimary: "#FFF", textSecondary: "#8993A7" } as never;

function day(dayKey: string, totalSeconds: number, segments: EarlierDay["segments"] = []): EarlierDay {
  return { date: new Date(), dateLabel: "6 Oct", dayKey, segments, spokenDate: "Tuesday 6 October", totalSeconds, weekday: "Tue" };
}

describe("EarlierThisWeek", () => {
  it("shows each earlier day with its mini ribbon and total, and opens it in Calendar", () => {
    const onOpenDay = vi.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <EarlierThisWeek
          days={[
            day("2026-10-06", 125 * 60, [{ key: "a", color: "blue", left: 0.25, width: 0.25 }, { key: "b", color: null, left: 0.75, width: 0.05 }]),
            day("2026-10-05", 0),
          ]}
          onOpenDay={onOpenDay}
          theme={theme}
        />,
      );
    });
    const texts = tree.root.findAllByType("Text" as never).map((node) => node.props.children);
    expect(texts.slice(0, 2)).toEqual(["Earlier this week", "Tap a day"]);
    expect(texts).toContain("2h 5m");
    expect(texts).toContain("0m");

    const first = tree.root.findByProps({ testID: "earlier-day-2026-10-06" });
    expect(first.props.accessibilityLabel).toBe("Tuesday 6 October, 2 hours 5 minutes");
    expect(first.props.accessibilityHint).toBe("Opens this day in Calendar");
    expect(tree.root.findByProps({ testID: "earlier-day-2026-10-05" }).props.accessibilityLabel).toBe("Tuesday 6 October, nothing framed");

    const segments = first.findAll((node) => node.type === ("View" as never) && Array.isArray(node.props.style) && node.props.style[1]?.left !== undefined);
    expect(segments.map((node) => [node.props.style[1].left, node.props.style[1].width])).toEqual([["25%", "25%"], ["75%", "5%"]]);
    // An entry with no activity draws in the neutral colour.
    expect(segments[1].props.style[1].backgroundColor).toBe("#707B91");

    act(() => first.props.onPress());
    expect(onOpenDay).toHaveBeenCalledWith("2026-10-06");
  });

  it("adds a hatched count chip to a day with open Review moments, and says so to VoiceOver", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <EarlierThisWeek
          days={[day("2026-10-12", 0), day("2026-10-11", 3600)]}
          onOpenDay={vi.fn()}
          reviewCounts={new Map([["2026-10-12", 2]])}
          theme={theme}
        />,
      );
    });
    const row = tree.root.findByProps({ testID: "earlier-day-2026-10-12" });
    expect(row.props.accessibilityLabel).toBe("Tuesday 6 October, nothing framed, 2 moments to review");
    const chip = tree.root.findByProps({ testID: "earlier-day-review-2026-10-12" });
    expect(chip.findAllByType("Text" as never).map((node) => node.props.children)).toEqual([2]);
    expect(chip.findAllByType("Svg" as never)).toHaveLength(1);
    // A neutral chip: the muted surface, not an activity or coral colour.
    expect(chip.props.style[1]).toEqual({ backgroundColor: "#202838" });
    // A day without open moments has no chip and an unchanged label.
    expect(tree.root.findAllByProps({ testID: "earlier-day-review-2026-10-11" })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: "earlier-day-2026-10-11" }).props.accessibilityLabel).toBe("Tuesday 6 October, 1 hour");
  });
});
