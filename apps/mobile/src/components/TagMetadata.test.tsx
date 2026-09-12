import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View" }));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path" }));

import { TagMetadata } from "./TagMetadata";

const styles = {
  tagMetadataRow: { flexDirection: "row", flexWrap: "wrap" },
  tagMetadataTagGroup: { flexDirection: "row" },
  tagMetadataTagButton: { minWidth: 44, minHeight: 44, paddingHorizontal: 4 },
  tagMetadataText: { fontSize: 12 },
  tagMetadataSeparator: { fontSize: 12 },
  buttonPressed: { opacity: 0.8 },
} as never;
const theme = { accentText: "accent", textSecondary: "secondary" } as never;

describe("TagMetadata", () => {
  it("keeps remove actions separate, capped, and at least 44 points without overlapping hit slop", () => {
    const onPressTag = vi.fn();
    const measured: string[] = [];
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <TagMetadata
          active
          diagnostic={{ onLayout: (id) => measured.push(id) }}
          diagnosticPrefix="tags.qa"
          onPressTag={onPressTag}
          styles={styles}
          tagNames={["recovery", "important"]}
          theme={theme}
        />,
      );
    });

    const buttons = tree.root.findAllByType("Pressable" as never);
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual([
      "Remove tag recovery",
      "Remove tag important",
    ]);
    expect(buttons.map((button) => button.props.accessibilityRole)).toEqual(["button", "button"]);
    for (const button of buttons) {
      expect(button.props.hitSlop).toBeUndefined();
      expect(button.props.style({ pressed: false })).toContainEqual({ minWidth: 44, minHeight: 44, paddingHorizontal: 4 });
    }
    const tagTexts = tree.root.findAllByType("Text" as never).filter((node) =>
      node.children.length > 0 && !node.props.accessibilityElementsHidden,
    );
    expect(tagTexts.map((node) => node.props.maxFontSizeMultiplier)).toEqual([1.3, 1.3]);
    expect(tagTexts.every((node) => node.props.allowFontScaling)).toBe(true);

    act(() => buttons[0].props.onPress());
    act(() => buttons[1].props.onPress());
    expect(onPressTag.mock.calls).toEqual([["recovery"], ["important"]]);
    act(() => tree.root.findByType("View" as never).props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 250, height: 44 } },
    }));
    expect(measured).toEqual(["tags.qa"]);
    act(() => tree.unmount());
  });

  it("speaks read-only tags as one complete label and can hide duplicated children", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<TagMetadata styles={styles} tagNames={["rest", "recovery"]} theme={theme} />);
    });
    const row = tree.root.findByType("View" as never);
    expect(row.props.accessible).toBe(true);
    expect(row.props.accessibilityLabel).toBe("Tags: rest · recovery");
    act(() => tree.unmount());

    act(() => {
      tree = create(<TagMetadata accessibilityHidden styles={styles} tagNames={["rest"]} theme={theme} />);
    });
    const hiddenRow = tree.root.findByType("View" as never);
    expect(hiddenRow.props.accessible).toBe(false);
    expect(hiddenRow.props.accessibilityElementsHidden).toBe(true);
    expect(hiddenRow.props.importantForAccessibility).toBe("no-hide-descendants");
    act(() => tree.unmount());
  });
});
