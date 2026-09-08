import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View"
}));

import { SegmentedPillControl } from "./SegmentedPillControl";

const theme = {
  surfaceMuted: "muted",
  accentSoft: "accent-soft",
  accentText: "accent-text",
  textSecondary: "secondary"
} as never;

describe("SegmentedPillControl", () => {
  it("renders 44-point selected controls and dispatches the selected value", () => {
    const onChange = vi.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<SegmentedPillControl accessibilityLabel="Period" onChange={onChange} options={[{ label: "Today", value: "today" }, { label: "Week", value: "week" }]} theme={theme} value="today" />);
    });
    const today = tree.root.findByProps({ accessibilityLabel: "Today" });
    const week = tree.root.findByProps({ accessibilityLabel: "Week" });
    expect(today.props.accessibilityState).toEqual({ disabled: false, selected: true });
    expect(week.props.accessibilityState).toEqual({ disabled: false, selected: false });
    expect(week.props.style({ pressed: false })[0]).toMatchObject({ minHeight: 44, minWidth: 68 });
    act(() => week.props.onPress());
    expect(onChange).toHaveBeenCalledExactlyOnceWith("week");
  });
});
