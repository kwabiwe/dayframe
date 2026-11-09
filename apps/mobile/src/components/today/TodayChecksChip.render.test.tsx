import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style },
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
}));
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" } }));
vi.mock("../../lib/motion", () => ({ localPresenceEntering: () => "enter", localPresenceExiting: () => "exit" }));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));
vi.mock("../icons/DayframeIcon", () => ({ DayframeIcon: (props: { glyph: string }) => `icon:${props.glyph}` }));

import { TodayChecksChip } from "./TodayChecksChip";

const theme = { surfaceMuted: "#222", warningText: "#FB0" } as never;

describe("Today's checks chip (location v4 step 14)", () => {
  it("reserves 44 points before and after the count and exposes only the current action", () => {
    const onOpen = vi.fn();
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<TodayChecksChip count={0} onOpen={onOpen} reduceMotion={false} theme={theme} />); });
    const slot = tree.root.findByProps({ testID: "today-checks-slot" });
    expect(slot.props.style.height).toBe(44);
    expect(slot.findAllByProps({ testID: "today-checks-chip" })).toHaveLength(0);
    act(() => { tree.update(<TodayChecksChip count={3} onOpen={onOpen} reduceMotion={false} theme={theme} />); });
    const chip = slot.findByProps({ testID: "today-checks-chip" });
    expect(chip.props.accessibilityLabel).toBe("3 to check today");
    expect(chip.props.accessibilityRole).toBe("button");
    act(() => { chip.props.onPress(); });
    expect(onOpen).toHaveBeenCalled();
    // It leaves with the app's local presence fade.
    expect(tree.root.findByType("AnimatedView" as never).props.exiting).toBe("exit");
    act(() => { tree.update(<TodayChecksChip count={0} onOpen={onOpen} reduceMotion={false} theme={theme} />); });
    expect(slot.props.style.height).toBe(44);
    expect(slot.findAllByProps({ testID: "today-checks-chip" })).toHaveLength(0);
    act(() => { tree.update(<TodayChecksChip count={4} onOpen={onOpen} reduceMotion theme={theme} />); });
    expect(slot.findByProps({ testID: "today-checks-chip" }).props.accessibilityLabel).toBe("4 to check today");
    expect(tree.root.findByType("AnimatedView" as never).props.entering).toBeUndefined();
    expect(tree.root.findByType("AnimatedView" as never).props.exiting).toBeUndefined();
  });
});
