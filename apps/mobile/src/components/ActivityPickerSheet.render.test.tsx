import { forwardRef, useImperativeHandle } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({ dismiss: vi.fn() }));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 59 }) }));
vi.mock("./SwipeDismissSheet", async () => {
  const React = await import("react");
  return {
    SwipeDismissSheet: forwardRef(function Sheet({ children }: { children: unknown }, ref) {
      useImperativeHandle(ref, () => ({ dismiss: mocks.dismiss }));
      return React.createElement("Sheet", null, children as never);
    }),
  };
});
vi.mock("./icons/DayframeIcon", () => ({ ActivityIcon: () => null, DayframeIcon: () => null }));
vi.mock("../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));

import { ActivityPickerSheet } from "./ActivityPickerSheet";

const theme = { dangerText: "#f55", mode: "dark", surfaceInset: "#111", surfaceMuted: "#222", textMuted: "#777", textPrimary: "#fff", textSecondary: "#aaa" } as never;
const activities = [
  { color: "blue", icon: "work", id: "work", isPinned: true, name: "Work" },
  { color: "amber", icon: "learning", id: "learn", isPinned: true, name: "Learning" },
];

function render(overrides: Record<string, unknown> = {}) {
  mocks.dismiss.mockClear();
  const props = { activities, onClose: vi.fn(), onCreate: vi.fn(), onPick: vi.fn(), recentIds: ["learn"], reduceMotion: false, selectedId: "work", styles: {} as never, theme, ...overrides };
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<ActivityPickerSheet {...props} />);
  });
  const texts = () => tree.root.findAllByType("Text" as never).map((node) => node.children.join(""));
  const search = (value: string) => act(() => tree.root.findByProps({ testID: "activity-picker-search" }).props.onChangeText(value));
  return { props, search, texts, tree };
}

describe("ActivityPickerSheet", () => {
  it("lists the count, Recent and groups, and picks once", () => {
    const { props, texts, tree } = render();
    expect(texts()).toEqual(expect.arrayContaining(["2 activities", "RECENT", "WORK AND STUDY", "Work", "Learning"]));
    expect(tree.root.findAllByProps({ testID: "activity-picker-create" })).toHaveLength(0);
    act(() => tree.root.findByProps({ testID: "activity-picker-row-recent-learn" }).props.onPress());
    act(() => tree.root.findByProps({ testID: "activity-picker-row-group-work-work" }).props.onPress());
    expect(props.onPick).toHaveBeenCalledOnce();
    expect(props.onPick).toHaveBeenCalledWith("learn");
    expect(mocks.dismiss).toHaveBeenCalledOnce();
    act(() => tree.unmount());
  });

  it("filters as you type and offers Create for a new name", async () => {
    const onCreate = vi.fn(() => Promise.resolve("pottery"));
    const { props, search, texts, tree } = render({ onCreate });
    search("work");
    expect(tree.root.findAllByProps({ testID: "activity-picker-create" })).toHaveLength(0);
    search("Pottery");
    expect(texts()).toContain('No activity called "Pottery" yet.');
    await act(async () => {
      await tree.root.findByProps({ testID: "activity-picker-create" }).props.onPress();
    });
    expect(onCreate).toHaveBeenCalledWith("Pottery");
    expect(props.onPick).toHaveBeenCalledWith("pottery");
    act(() => tree.unmount());
  });

  it("keeps the sheet open with a plain message when creating fails", async () => {
    const { props, search, texts, tree } = render({ onCreate: vi.fn(() => Promise.resolve(null)) });
    search("Pottery");
    await act(async () => {
      await tree.root.findByProps({ testID: "activity-picker-create" }).props.onPress();
    });
    expect(props.onPick).not.toHaveBeenCalled();
    expect(mocks.dismiss).not.toHaveBeenCalled();
    expect(texts()).toContain(`Couldn't create "Pottery". Check your connection and try again.`);
    act(() => tree.unmount());
  });
});
