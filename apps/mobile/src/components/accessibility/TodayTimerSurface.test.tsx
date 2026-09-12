import { act, create } from "react-test-renderer";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Animated: { View: "AnimatedView" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));
vi.mock("react-native-svg", () => ({
  Circle: "Circle",
  Path: "Path",
  Rect: "Rect",
  default: "Svg",
}));
vi.mock("../PrimaryTimerAction", async () => {
  const ReactRuntime = await import("react");
  return {
    PlusGlyph: () => ReactRuntime.createElement("PlusGlyph"),
    PrimaryTimerAction: ({ accessibilityLabel, onPress }: { accessibilityLabel: string; onPress: (event: unknown) => void }) =>
      ReactRuntime.createElement("Pressable", { accessibilityLabel, accessibilityRole: "button", onPress }),
  };
});

import { TodayTimerSurface, type TodayActiveTimerPresentation } from "./TodayTimerSurface";

const styles = new Proxy({}, { get: (_target, key) => ({ testStyle: String(key) }) }) as never;
const theme = {
  accent: "coral",
  accentText: "coralText",
  mode: "dark",
  onAccent: "white",
} as never;
const quickActions = [
  {
    color: "moss",
    id: "category-1",
    isUncategorized: false,
    key: "category:1",
    name: "A longer quick action name",
    subtitle: null,
  },
];

function props(overrides: Partial<ComponentProps<typeof TodayTimerSurface>> = {}) {
  return {
    active: null,
    onAddTime: vi.fn(),
    onOpenActiveTimer: vi.fn(),
    onStartBlank: vi.fn(),
    onStartQuickAction: vi.fn(),
    onStop: vi.fn(),
    quickActions,
    styles,
    theme,
    ...overrides,
  };
}

describe("TodayTimerSurface", () => {
  it("renders the actual idle composer with scoped roles and keeps callbacks behind their actions", () => {
    const input = props();
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<TodayTimerSurface {...input} />); });
    const roleText = (value: string) => tree.root.findAllByType("Text" as never).find((node) => node.children.join("") === value)!;
    expect(roleText("What are you working on?").props.maxFontSizeMultiplier).toBe(1.3);
    expect(roleText("QUICK ACTIONS").props.maxFontSizeMultiplier).toBe(1.2);
    expect(roleText("A longer quick action name").props.maxFontSizeMultiplier).toBe(1.3);
    expect(roleText("A longer quick action name").props.allowFontScaling).toBe(true);
    expect(input.onStartBlank).not.toHaveBeenCalled();
    expect(input.onStartQuickAction).not.toHaveBeenCalled();
    act(() => tree.root.findByProps({ accessibilityLabel: "Start timer and add details" }).props.onPress());
    act(() => tree.root.findByProps({ accessibilityLabel: "Start A longer quick action name" }).props.onPress());
    expect(input.onStartBlank).toHaveBeenCalledOnce();
    expect(input.onStartQuickAction).toHaveBeenCalledWith(quickActions[0]);
    act(() => tree.unmount());
  });

  it("keeps the running title, category, complete clock and separate Stop/Add callbacks", () => {
    const active: TodayActiveTimerPresentation = {
      categoryColor: "moss",
      categoryLabel: "Research",
      elapsedLabel: "12:34:56",
      hasLiveActiveTimer: true,
      title: "A long running timer title",
      titleIsPlaceholder: false,
    };
    const input = props({ active });
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<TodayTimerSurface {...input} />); });
    const text = (value: string) => tree.root.findAllByType("Text" as never).find((node) => node.children.join("") === value)!;
    expect(text(active.title).props.maxFontSizeMultiplier).toBe(1.35);
    expect(text("Research").props.maxFontSizeMultiplier).toBe(1.3);
    expect(text("12:34:56").props.maxFontSizeMultiplier).toBe(1.2);
    expect(text("12:34:56").props.allowFontScaling).toBe(true);
    expect(input.onStop).not.toHaveBeenCalled();

    const stopEvent = { stopPropagation: vi.fn() };
    act(() => tree.root.findByProps({ accessibilityLabel: "Stop current timer" }).props.onPress(stopEvent));
    const addEvent = { stopPropagation: vi.fn() };
    act(() => tree.root.findByProps({ testID: "active-timer-add-past-time" }).props.onPress(addEvent));
    expect(stopEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(addEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(input.onStop).toHaveBeenCalledOnce();
    expect(input.onAddTime).toHaveBeenCalledOnce();
    expect(input.onOpenActiveTimer).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
