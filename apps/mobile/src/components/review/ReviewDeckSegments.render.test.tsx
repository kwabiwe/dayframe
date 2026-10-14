import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({
  focusEvents: [] as unknown[],
  springs: [] as Array<{ to: number; config: unknown }>
}));
vi.mock("react-native", () => ({
  AccessibilityInfo: {
    sendAccessibilityEvent: (target: unknown, event: string) => mocks.focusEvents.push([target, event])
  },
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 0.5 },
  Text: "Text",
  View: "View"
}));
vi.mock("react-native-reanimated", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  const React = await import("../../../../../node_modules/react/index.js");
  return {
    default: { View: "AnimatedView" },
    ReduceMotion: { Never: "never" },
    // A plain object stands in for the shared value, so the test can read where the thumb was sent.
    useSharedValue: (initial: number) => (React as typeof import("react")).useRef({ value: initial }).current,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    withSpring: (to: number, config: unknown) => {
      mocks.springs.push({ to, config });
      return { spring: to };
    }
  };
});
vi.mock("@dayframe/shared", () => ({ DAYFRAME_BLOCKS: { radius: { pill: 999 } } }));
vi.mock("@/lib/blocksMotion", () => ({ BLOCKS_SPRING: { sheet: { stiffness: 340, damping: 34, mass: 1 } } }));
vi.mock("@/lib/motion", () => ({ localPresenceEntering: () => "entering", localPresenceExiting: () => "exiting" }));
vi.mock("@/lib/mobileTypography", () => ({ MOBILE_DISPLAY_FONT: { bold: "Display" }, mobileTextProps: () => ({}) }));
vi.mock("@/lib/reviewDeckSegments", async () => import("../../lib/reviewDeckSegments"));

import {
  ReviewDeckOlderDivider,
  ReviewDeckSegmentControl,
  ReviewDeckSegmentFramed,
  reviewDeckSegmentColors
} from "./ReviewDeckSegments";

const theme = {
  accent: "#FF6B57",
  border: "#2A3346",
  mode: "dark",
  onAccent: "#050914",
  surface: "#151B26",
  surfaceInset: "#101622",
  surfaceMuted: "#202838",
  textMuted: "#707B91",
  textPrimary: "#FFF",
  textSecondary: "#8993A7"
} as never;

const counts = (today: number, earlier: number, exact = true) => ({
  today: { value: today, exact },
  earlier: { value: earlier, exact }
});

function renderControl(props: Partial<Parameters<typeof ReviewDeckSegmentControl>[0]> = {}) {
  const onSelect = vi.fn();
  let tree!: ReturnType<typeof create>;
  const element = (next: Partial<Parameters<typeof ReviewDeckSegmentControl>[0]>) => (
    <ReviewDeckSegmentControl
      animateChange={false}
      counts={counts(3, 9)}
      onSelect={onSelect}
      reduceMotion={false}
      selected="today"
      theme={theme}
      {...props}
      {...next}
    />
  );
  act(() => {
    tree = create(element({}));
  });
  // The track is measured before the thumb is drawn.
  act(() => {
    tree.root.findByProps({ testID: "review-deck-segments" }).props.onLayout({ nativeEvent: { layout: { width: 306 } } });
  });
  return { onSelect, rerender: (next: Partial<Parameters<typeof ReviewDeckSegmentControl>[0]>) => act(() => tree.update(element(next))), tree };
}

function texts(node: ReturnType<typeof create>["root"]) {
  return node.findAllByType("Text" as never).map((text) => text.props.children);
}

beforeEach(() => {
  mocks.focusEvents.length = 0;
  mocks.springs.length = 0;
});

describe("ReviewDeckSegmentControl", () => {
  it("is a tab bar of two segments, each with its count", () => {
    const { tree } = renderControl();
    const bar = tree.root.findByProps({ testID: "review-deck-segments" });
    expect(bar.props.accessibilityRole).toBe("tablist");
    expect(texts(tree.root)).toEqual(["Today", "3", "Earlier", "9"]);
    const today = tree.root.findByProps({ testID: "review-deck-segment-today" });
    const earlier = tree.root.findByProps({ testID: "review-deck-segment-earlier" });
    expect(today.props).toMatchObject({ accessibilityLabel: "Today, 3 moments", accessibilityRole: "tab", accessibilityState: { selected: true } });
    expect(earlier.props).toMatchObject({ accessibilityLabel: "Earlier, 9 moments", accessibilityState: { selected: false } });
  });

  it("is neutral: a muted thumb on an inset track in Midnight, never coral", () => {
    const { tree } = renderControl();
    expect(tree.root.findByProps({ testID: "review-deck-segments" }).props.style[1]).toEqual({ backgroundColor: "#101622" });
    expect(tree.root.findByProps({ testID: "review-deck-segment-thumb" }).props.style[1]).toMatchObject({ backgroundColor: "#202838", width: 150 });
    expect(reviewDeckSegmentColors({ ...(theme as object), mode: "light" } as never)).toEqual({ track: "#202838", thumb: "#151B26" });
  });

  it("shows \"9+\" for a count that is not exact yet and dims only a segment that is certainly empty", () => {
    const { tree } = renderControl({ counts: { today: { value: 0, exact: true }, earlier: { value: 97, exact: false } } });
    expect(texts(tree.root)).toEqual(["Today", "0", "Earlier", "97+"]);
    const labels = tree.root.findAll((node) => node.type === ("View" as never) && Array.isArray(node.props.style) && node.props.style[0]?.flexDirection === "row" && node.props.style[0]?.alignItems === "baseline");
    expect(labels.map((label) => label.props.style[1])).toEqual([{ opacity: 0.45 }, null]);
    expect(tree.root.findByProps({ testID: "review-deck-segment-earlier" }).props.accessibilityLabel).toBe("Earlier, at least 97 moments");
  });

  it("does nothing when the selected segment is tapped, and asks for the other one", () => {
    const { onSelect, tree } = renderControl();
    act(() => tree.root.findByProps({ testID: "review-deck-segment-today" }).props.onPress());
    expect(onSelect).not.toHaveBeenCalled();
    act(() => tree.root.findByProps({ testID: "review-deck-segment-earlier" }).props.onPress());
    expect(onSelect).toHaveBeenCalledWith("earlier");
  });

  it("slides the thumb with the sheet spring only for the user's switch, and places it at once otherwise", () => {
    const { rerender } = renderControl();
    // First placement: no motion.
    expect(mocks.springs).toEqual([]);
    rerender({ animateChange: true, selected: "earlier" });
    expect(mocks.springs).toEqual([{ to: 150, config: { stiffness: 340, damping: 34, mass: 1, reduceMotion: "never" } }]);
    // A rapid second switch retargets the same spring.
    rerender({ animateChange: true, selected: "today" });
    expect(mocks.springs.at(-1)?.to).toBe(0);
    // A count changing moves nothing.
    mocks.springs.length = 0;
    rerender({ animateChange: true, counts: counts(2, 9), selected: "today" });
    expect(mocks.springs).toEqual([]);
    // A placement (a focused card, the route) puts the thumb there without motion.
    rerender({ animateChange: false, selected: "earlier" });
    expect(mocks.springs).toEqual([]);
  });

  it("moves the thumb at once under Reduce Motion", () => {
    const { rerender, tree } = renderControl({ reduceMotion: true });
    rerender({ animateChange: true, selected: "earlier" });
    expect(mocks.springs).toEqual([]);
    // (The stand-in animated style reads the value on the next render.)
    rerender({ selected: "earlier", theme: { ...(theme as object) } as never });
    expect(tree.root.findByProps({ testID: "review-deck-segment-thumb" }).props.style[2]).toEqual({ transform: [{ translateX: 150 }] });
  });
});

describe("ReviewDeckSegmentFramed", () => {
  function renderFramed(focusToken: number) {
    const onAction = vi.fn();
    const onFocused = vi.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <ReviewDeckSegmentFramed
          action="Review earlier"
          actionAccessibilityLabel="Review earlier, 9 moments"
          detail="9 earlier moments to review."
          focusToken={focusToken}
          onAction={onAction}
          onFocused={onFocused}
          reduceMotion={false}
          theme={theme}
          title="Today is framed"
        />,
        { createNodeMock: () => ({ heading: true }) }
      );
    });
    return { onAction, onFocused, tree };
  }

  it("says Today is framed, how many earlier moments wait, and switches with one pill", () => {
    const { onAction, tree } = renderFramed(0);
    expect(texts(tree.root)).toEqual(["Today is framed", "9 earlier moments to review.", "Review earlier"]);
    const heading = tree.root.findAllByType("Text" as never)[0];
    expect(heading.props.accessibilityRole).toBe("header");
    const pill = tree.root.findByProps({ testID: "review-deck-segment-switch" });
    expect(pill.props.accessibilityLabel).toBe("Review earlier, 9 moments");
    act(() => pill.props.onPress());
    expect(onAction).toHaveBeenCalledTimes(1);
    // Presence fades, no landing motion; nothing moves focus without a segment switch.
    expect(tree.root.findByProps({ testID: "review-deck-segment-framed" }).props).toMatchObject({ entering: "entering", exiting: "exiting" });
    expect(mocks.focusEvents).toEqual([]);
  });

  it("takes VoiceOver focus on its heading once after a segment switch", () => {
    const { onFocused } = renderFramed(4);
    expect(mocks.focusEvents).toEqual([[{ heading: true }, "focus"]]);
    expect(onFocused).toHaveBeenCalledWith(4);
  });
});

describe("ReviewDeckOlderDivider", () => {
  it("reserves its row either way and shows \"Older than 7 days\" only when asked", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<ReviewDeckOlderDivider reduceMotion={false} theme={theme} visible={false} />);
    });
    expect(tree.root.findByProps({ testID: "review-deck-divider-slot" }).props.style).toMatchObject({ minHeight: 18 });
    expect(tree.root.findAllByProps({ testID: "review-deck-older-divider" })).toHaveLength(0);
    act(() => tree.update(<ReviewDeckOlderDivider reduceMotion={false} theme={theme} visible />));
    expect(texts(tree.root)).toEqual(["Older than 7 days"]);
  });
});
