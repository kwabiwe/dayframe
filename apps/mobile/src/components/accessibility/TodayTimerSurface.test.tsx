import { act, create, type ReactTestInstance } from "react-test-renderer";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { blockColorsFor, DAYFRAME_THEME } from "@dayframe/shared";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  Animated: { View: "AnimatedView" },
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ fontScale: 1, height: 874, scale: 3, width: 402 }),
}));
vi.mock("react-native-svg", () => ({
  Circle: "Circle",
  Ellipse: "Ellipse",
  Line: "Line",
  Path: "Path",
  Polygon: "Polygon",
  Polyline: "Polyline",
  Rect: "Rect",
  default: "Svg",
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: "ReanimatedView" },
  Easing: { inOut: () => undefined, sin: undefined },
  ReduceMotion: { Always: "always", Never: "never", System: "system" },
  cancelAnimation: vi.fn(),
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useSharedValue: (value: unknown) => ({ value }),
  withDelay: (_delay: number, animation: unknown) => animation,
  withRepeat: (animation: unknown) => animation,
  withSequence: (...animations: unknown[]) => animations[0],
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
}));
vi.mock("../PrimaryTimerAction", async () => {
  const ReactRuntime = await import("react");
  return { PrimaryTimerGlyph: ({ mode }: { mode: string }) => ReactRuntime.createElement("PrimaryTimerGlyph", { mode }) };
});
vi.mock("../../lib/motion", () => ({
  MOBILE_MOTION: { control: 140, layout: 220 },
  localLayoutTransition: () => "layout",
  localPresenceEntering: () => "entering",
  localPresenceExiting: () => "exiting",
}));

import { TodayTimerSurface, type TodayActiveTimerPresentation } from "./TodayTimerSurface";
import { layoutQuickStartMosaic, quickStartTileFrames } from "../../lib/quickStartMosaic";

const darkTheme = { ...DAYFRAME_THEME.dark, mode: "dark", pressed: "pressed" } as never;
const lightTheme = { ...DAYFRAME_THEME.light, mode: "light", pressed: "pressed" } as never;
const columns = layoutQuickStartMosaic([
  { color: "moss", icon: "work", id: "work", name: "Work", weekSeconds: 7200 },
  { color: "blue", icon: null, id: "gym", name: "Gym", weekSeconds: 1800 },
]);

const running: TodayActiveTimerPresentation = {
  categoryColor: "moss",
  categoryIcon: "work",
  categoryLabel: "Work",
  elapsedLabel: "1:02:03",
  elapsedSeconds: 3723,
  hasLiveActiveTimer: true,
  startedLabel: "Started 09:12",
  title: "A long running timer title",
  titleIsPlaceholder: false,
};

function props(overrides: Partial<ComponentProps<typeof TodayTimerSurface>> = {}) {
  return {
    active: null,
    liveLanding: null,
    onAddTime: vi.fn(),
    onOpenActiveTimer: vi.fn(),
    onStartActivity: vi.fn(),
    onStartBlank: vi.fn(),
    onStop: vi.fn(),
    quickStartColumns: columns,
    reduceMotion: false,
    runningActivityId: null,
    theme: darkTheme,
    ...overrides,
  };
}

function render(input: ComponentProps<typeof TodayTimerSurface>) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<TodayTimerSurface {...input} />);
  });
  // Tiles are absolutely positioned from the measured mosaic width.
  const mosaic = tree.root.findAllByProps({ testID: "today-quick-start-mosaic" })[0];
  if (mosaic) act(() => mosaic.props.onLayout({ nativeEvent: { layout: { height: 232, width: 343, x: 0, y: 0 } } }));
  const text = (value: string) =>
    tree.root.findAllByType("Text" as never).find((node) => node.children.join("") === value) as ReactTestInstance;
  const byLabel = (label: string) => tree.root.findByProps({ accessibilityLabel: label });
  return { byLabel, text, tree };
}

function flatStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatStyle));
  return (style && typeof style === "object" ? style : {}) as Record<string, unknown>;
}

describe("TodayTimerSurface (Blocks)", () => {
  it("shows the prototype idle card: a coral Start a block pill, Add past time, and the mosaic", () => {
    const input = props();
    const { byLabel, text, tree } = render(input);
    expect(text("NOTHING RECORDING")).toBeDefined();
    const prompt = text("What are you working on?");
    expect(prompt.props.maxFontSizeMultiplier).toBe(1.35);
    expect(flatStyle(prompt.props.style).fontFamily).toBe("BricolageGrotesque-Bold");
    const headers = tree.root.findAllByType("Text" as never).filter((node) => node.children.join("") === "Start a block");
    expect(headers.some((node) => node.props.accessibilityRole === "header")).toBe(true);
    expect(flatStyle(byLabel("Start a block").props.style({ pressed: false })).backgroundColor).toBe(DAYFRAME_THEME.dark.accent);
    expect(flatStyle(byLabel("Add past time").props.style({ pressed: false })).minHeight).toBe(44);

    act(() => byLabel("Start a block").props.onPress());
    act(() => byLabel("Add past time").props.onPress());
    act(() => byLabel("Start Work, 2 hours in the last 7 days").props.onPress());
    expect(input.onStartBlank).toHaveBeenCalledOnce();
    expect(input.onAddTime).toHaveBeenCalledOnce();
    expect(input.onStartActivity).toHaveBeenCalledWith("work");
    expect(text("2h").props.allowFontScaling).toBe(true);
    act(() => tree.unmount());
  });

  it("renders the running entry as one solid block with measured on-block text", () => {
    for (const theme of [darkTheme, lightTheme]) {
      const { text, tree } = render(props({ active: running, runningActivityId: "work", theme }));
      const mode = (theme as { mode: "dark" | "light" }).mode;
      const expected = blockColorsFor("moss", mode, "Work");
      const block = tree.root.findByProps({ testID: "today-live-block" });
      expect(flatStyle(block.props.style).backgroundColor).toBe(expected.fill);
      for (const value of ["Work", running.title, "Started 09:12", "Recording"]) {
        const style = flatStyle(text(value).props.style);
        expect(style.color).toBe(expected.text);
        expect(style.opacity).toBeUndefined();
      }
      act(() => tree.unmount());
    }
  });

  it("rolls the timer in the display face with tabular figures, hidden from VoiceOver", () => {
    const { text, tree } = render(props({ active: running, runningActivityId: "work" }));
    const odometer = tree.root.findByProps({ testID: "today-live-odometer" });
    expect(odometer.props.accessibilityElementsHidden).toBe(true);
    // "1:02:03": five digit cells, each a 0–9 strip, and two colons drawn as dots.
    const digits = odometer.findAllByType("Text" as never);
    expect(digits).toHaveLength(50);
    const style = flatStyle(digits[0].props.style);
    expect(style.fontFamily).toBe("BricolageGrotesque-Bold");
    expect(style.fontVariant).toEqual(["tabular-nums"]);
    expect(style.color).toBe(blockColorsFor("moss", "dark", "Work").text);
    expect(text(running.title).props.maxFontSizeMultiplier).toBe(1.35);
    act(() => tree.unmount());
  });

  it("keeps Edit, Stop and Add past time as separate VoiceOver actions", () => {
    const input = props({ active: running, runningActivityId: "work" });
    const { byLabel, tree } = render(input);
    expect(byLabel("Edit running timer").props.accessibilityValue).toEqual({
      text: "Work. A long running timer title. 1 hour 2 minutes so far.",
    });
    const stopEvent = { stopPropagation: vi.fn() };
    act(() => byLabel("Stop current timer").props.onPress(stopEvent));
    const addEvent = { stopPropagation: vi.fn() };
    act(() => tree.root.findByProps({ testID: "active-timer-add-past-time" }).props.onPress(addEvent));
    act(() => byLabel("Edit running timer").props.onPress());
    expect(stopEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(addEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(input.onStop).toHaveBeenCalledOnce();
    expect(input.onAddTime).toHaveBeenCalledOnce();
    expect(input.onOpenActiveTimer).toHaveBeenCalledOnce();
    act(() => tree.unmount());
  });

  it("switches from the mosaic while running and never starts a duplicate of the running activity", () => {
    const input = props({ active: running, runningActivityId: "work" });
    const { byLabel, text, tree } = render(input);
    expect(text("Switch to").props.accessibilityRole).toBe("header");
    act(() => byLabel("Work, recording. Edit running timer").props.onPress());
    act(() => byLabel("Switch to Gym, 30 minutes in the last 7 days").props.onPress());
    expect(input.onOpenActiveTimer).toHaveBeenCalledOnce();
    expect(input.onStartActivity).toHaveBeenCalledOnce();
    expect(input.onStartActivity).toHaveBeenCalledWith("gym");
    act(() => tree.unmount());
  });

  it("lands the block's content only: the card, ring and actions never move", () => {
    const landing = { requestedAt: Date.now(), token: 1 };
    const { tree } = render(props({ active: running, liveLanding: landing, runningActivityId: "work" }));
    const card = flatStyle(tree.root.findByProps({ testID: "today-live-block" }).props.style);
    const content = flatStyle(tree.root.findByProps({ testID: "today-live-content" }).props.style);
    expect(card.transform).toBeUndefined();
    // A due landing mounts the content at its 14-point offset; the spring then brings it to rest.
    expect(content.transform).toEqual([{ translateY: 14 }]);
    act(() => tree.unmount());
  });

  it("never clips the start time: the footer wraps the reserved action space instead", () => {
    const { tree } = render(props({ active: { ...running, elapsedLabel: "123:45:06" }, runningActivityId: "work" }));
    const reserve = tree.root.findByProps({ testID: "today-live-actions-reserve" });
    expect(flatStyle(reserve.props.style)).toMatchObject({ height: 56, marginLeft: "auto", width: 110 });
    expect(flatStyle(reserve.parent!.props.style)).toMatchObject({ flexDirection: "row", flexWrap: "wrap" });
    act(() => tree.unmount());
  });

  it("positions mosaic tiles absolutely from the shared frame calculation", () => {
    const { tree } = render(props());
    const slots = tree.root.findAllByType("ReanimatedView" as never)
      .map((node) => flatStyle(node.props.style))
      .filter((style) => style.position === "absolute");
    const expected = quickStartTileFrames(columns, 343);
    expect(slots.map(({ left, top, width, height }) => ({ height, left, top, width }))).toEqual(
      expected.map(({ height, x, y, width }) => ({ height, left: x, top: y, width }))
    );
    act(() => tree.unmount());
  });

  it("makes Reanimated the only owner: slots and tiles animate their own layout", () => {
    const { tree } = render(props());
    expect(tree.root.findByProps({ testID: "today-timer-slot" }).props.layout).toBe("layout");
    expect(tree.root.findByProps({ testID: "today-quick-start-slot" }).props.layout).toBe("layout");
    const tiles = tree.root.findAllByType("ReanimatedView" as never)
      .filter((node) => flatStyle(node.props.style).position === "absolute");
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) expect(tile.props).toMatchObject({ exiting: "exiting", layout: "layout" });
    act(() => tree.unmount());
  });

  it("crossfades idle and live cards after first paint, but swaps in place under Reduce Motion", () => {
    const input = props();
    const { tree } = render(input);
    expect(tree.root.findByProps({ testID: "today-idle-slot" }).props.entering).toBeUndefined();
    act(() => tree.update(<TodayTimerSurface {...input} active={running} runningActivityId="work" />));
    expect(tree.root.findByProps({ testID: "today-live-slot" }).props).toMatchObject({ entering: "entering", exiting: "exiting" });
    act(() => tree.update(<TodayTimerSurface {...input} active={null} reduceMotion />));
    expect(tree.root.findByProps({ testID: "today-idle-slot" }).props.entering).toBeUndefined();
    expect(tree.root.findByProps({ testID: "today-idle-slot" }).props.exiting).toBeUndefined();
    act(() => tree.unmount());
  });

  it("shows an entry with no activity on a neutral surface", () => {
    const { text, tree } = render(props({ active: { ...running, categoryColor: null, categoryIcon: null, categoryLabel: null } }));
    const block = tree.root.findByProps({ testID: "today-live-block" });
    expect(flatStyle(block.props.style).backgroundColor).toBe(DAYFRAME_THEME.dark.surfaceRaised);
    expect(flatStyle(text("No activity").props.style).color).toBe(DAYFRAME_THEME.dark.textPrimary);
    act(() => tree.unmount());
  });

  it("hides the mosaic when nothing is pinned", () => {
    const { tree } = render(props({ quickStartColumns: [] }));
    expect(tree.root.findAllByProps({ testID: "today-quick-start" })).toHaveLength(0);
    act(() => tree.unmount());
  });
});
