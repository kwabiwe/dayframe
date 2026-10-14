import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const mocks = vi.hoisted(() => ({ announce: vi.fn() }));
vi.mock("react-native", () => ({
  AccessibilityInfo: { announceForAccessibility: (message: string) => mocks.announce(message) },
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(value: T) => value },
  Text: "Text",
  View: "View"
}));
vi.mock("react-native-reanimated", () => ({ default: { View: "ReanimatedView" }, useSharedValue: (value: unknown) => ({ value }) }));
vi.mock("../../lib/blocksMotion", () => ({
  blocksToastEntering: (reduceMotion: boolean) => ({ kind: "entering", spring: reduceMotion ? null : "pop", reduceMotion }),
  blocksToastExiting: (reduceMotion: boolean) => ({ kind: "exiting", reduceMotion })
}));
vi.mock("../../lib/mobileTypography", () => ({ MOBILE_TEXT_CAP: { control: 1.3 }, mobileTextProps: () => ({}) }));

const { BLOCKS_TOAST_DURATION_MS, BLOCKS_TOAST_METRICS, BlocksToast, useBlocksNotice } = await import("./BlocksToast");
const { switchedToastCopy } = await import("../../lib/blocksToastCopy");

const theme = {
  accent: "coral", background: "#050914", onAccent: "onCoral", shadow: "shadow", textMuted: "muted", textPrimary: "#F7F8FB"
} as never;

let tree: ReturnType<typeof create> | undefined;
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  mocks.announce.mockReset();
  vi.useRealTimers();
});

const host = () => tree!.root.find((node: ReactTestInstance) => (node.type as unknown) === "ReanimatedView");
const byTestId = (id: string) => tree!.root.find((node: ReactTestInstance) => node.props.testID === id && typeof node.type === "string");
const flatStyle = (node: ReactTestInstance) => {
  const style = typeof node.props.style === "function" ? node.props.style({ pressed: false }) : node.props.style;
  return Object.assign({}, ...[style].flat(3).filter(Boolean));
};
const texts = () => tree!.root.findAll((node: ReactTestInstance) => (node.type as unknown) === "Text").map((node) => node.children.join(""));

describe("BlocksToast (UIA-003)", () => {
  it("is an inverse pill with the activity swatch, one sentence and a neutral 44-point action", () => {
    const onAction = vi.fn();
    act(() => {
      tree = create(
        <BlocksToast
          actionAccessibilityLabel="Undo deleting Deep work"
          actionLabel="Undo"
          actionTestID="toast-undo"
          message="Deleted Deep work"
          onAction={onAction}
          reduceMotion={false}
          swatchColor="#4C8DFF"
          testID="toast"
          theme={theme}
        />
      );
    });
    expect(flatStyle(host()).backgroundColor).toBe("#F7F8FB");
    // A pill at its 52-point rest height (corners of half that height).
    expect(flatStyle(host()).borderRadius).toBe(flatStyle(host()).minHeight / 2);
    expect(flatStyle(host()).paddingRight).toBe(4);
    expect(host().props.accessibilityLiveRegion).toBe("polite");
    expect(texts()).toEqual(["Deleted Deep work", "Undo"]);
    expect(byTestId("toast-label").props.accessibilityLabel).toBe("Deleted Deep work");
    const swatch = byTestId("toast-swatch");
    expect(flatStyle(swatch).backgroundColor).toBe("#4C8DFF");
    expect(swatch.props.accessibilityElementsHidden).toBe(true);
    const action = byTestId("toast-undo");
    expect(action.props.accessibilityRole).toBe("button");
    expect(action.props.accessibilityLabel).toBe("Undo deleting Deep work");
    const actionStyle = flatStyle(action);
    expect(actionStyle.minHeight).toBeGreaterThanOrEqual(44);
    expect(actionStyle.minWidth).toBeGreaterThanOrEqual(44);
    // Neutral: a translucent wash of the canvas over the inverse bar, never coral.
    expect(actionStyle.backgroundColor).toBe("rgba(5, 9, 20, 0.14)");
    expect(actionStyle.backgroundColor).not.toBe("coral");
    act(() => action.props.onPress());
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("draws a neutral swatch and no action for a notice", () => {
    act(() => {
      tree = create(<BlocksToast message="Already recording Deep work" reduceMotion={false} testID="toast" theme={theme} />);
    });
    expect(flatStyle(byTestId("toast-swatch")).backgroundColor).toBe("muted");
    expect(tree!.root.findAll((node: ReactTestInstance) => (node.type as unknown) === "Pressable")).toHaveLength(0);
    // Without an action the text keeps the same 16 points from the right end as from the left.
    expect(flatStyle(host()).paddingRight).toBe(16);
  });

  it("shows the switch as one line, \"Switched to\" then the name, read by VoiceOver as one sentence", () => {
    const copy = switchedToastCopy("School run");
    act(() => {
      tree = create(
        <BlocksToast
          accessibilityLabel={copy.accessibilityLabel}
          lead={copy.lead}
          message={copy.message}
          name={copy.name}
          reduceMotion={false}
          swatchColor="#4C8DFF"
          testID="toast"
          theme={theme}
        />
      );
    });
    expect(texts()).toEqual(["Switched to", "School run"]);
    // No second line and no plain message line: the lead and the name are the whole toast.
    expect(tree!.root.findAll((node: ReactTestInstance) => node.props.testID === "toast-message")).toHaveLength(0);
    expect(tree!.root.findAll((node: ReactTestInstance) => node.props.testID === "toast-detail")).toHaveLength(0);
    // One VoiceOver element (swatch and words) reading one sentence.
    const label = byTestId("toast-label");
    expect(label.props.accessible).toBe(true);
    expect(label.props.accessibilityLabel).toBe("Switched to School run.");
    expect(tree!.root.findAll((node: ReactTestInstance) => node.props.accessible === true)).toHaveLength(1);
    // The toast itself never announces: its owner (useBlocksNotice) announces the sentence once.
    expect(mocks.announce).not.toHaveBeenCalled();
    expect(flatStyle(byTestId("toast-lead")).color).toBe("#050914");
    expect(flatStyle(byTestId("toast-name")).color).toBe("#050914");
    // A pill like every other toast: 52-point rest height, 26-point corners, 16 points each end.
    expect(flatStyle(host()).minHeight).toBe(52);
    expect(flatStyle(host()).borderRadius).toBe(26);
    expect(flatStyle(host()).paddingLeft).toBe(16);
    expect(flatStyle(host()).paddingRight).toBe(16);
    // The entrance and exit are the toast's own.
    expect(host().props.entering).toEqual({ kind: "entering", spring: "pop", reduceMotion: false });
    expect(host().props.exiting).toEqual({ kind: "exiting", reduceMotion: false });
  });

  it("truncates only the name: the lead never shrinks or wraps, the name is one line ending in \"…\"", () => {
    const copy = switchedToastCopy("Quarterly planning with the whole design and engineering group");
    act(() => {
      tree = create(<BlocksToast lead={copy.lead} message={copy.message} name={copy.name} reduceMotion={false} testID="toast" theme={theme} />);
    });
    const line = flatStyle(byTestId("toast-line"));
    expect(line.flexDirection).toBe("row");
    expect(line.minWidth).toBe(0);
    const lead = byTestId("toast-lead");
    expect(lead.props.numberOfLines).toBe(1);
    expect(flatStyle(lead).flexShrink).toBe(0);
    const name = byTestId("toast-name");
    expect(name.props.numberOfLines).toBe(1);
    expect(name.props.ellipsizeMode).toBe("tail");
    expect(flatStyle(name).flexShrink).toBe(1);
    expect(flatStyle(name).minWidth).toBe(0);
    // The full name is drawn (the ellipsis is layout's), and VoiceOver reads it whole.
    expect(name.children.join("")).toBe("Quarterly planning with the whole design and engineering group");
    expect(byTestId("toast-label").props.accessibilityLabel).toBe(copy.message);
    for (const node of [host(), byTestId("toast-label"), byTestId("toast-line"), lead, name]) {
      expect(flatStyle(node).height).toBeUndefined();
      expect(flatStyle(node).maxHeight).toBeUndefined();
    }
  });

  it("keeps other toasts' plain sentence wrapping to two lines (Already recording, delete Undo, Review, Settings)", () => {
    act(() => {
      tree = create(<BlocksToast message="Still loading your activities. Try again in a moment." reduceMotion={false} testID="toast" theme={theme} />);
    });
    const message = byTestId("toast-message");
    expect(message.props.numberOfLines).toBe(BLOCKS_TOAST_METRICS.messageMaxLines);
    expect(BLOCKS_TOAST_METRICS.messageMaxLines).toBe(2);
    expect(message.props.ellipsizeMode).toBeUndefined();
    expect(tree!.root.findAll((node: ReactTestInstance) => node.props.testID === "toast-lead")).toHaveLength(0);
    expect(flatStyle(host()).minHeight).toBe(52);
  });

  it("fits \"Switched to\" whole on one line at 375 points, at the default and the largest text size, leaving the rest to the name", () => {
    // Today's place (mobileTheme `todayToast`): 20 points in from each side, above the tab bar.
    const themeSource = readFileSync(fileURLToPath(new URL("../../lib/mobileTheme.ts", import.meta.url)), "utf8");
    const place = /todayToast: \{([^}]*)\}/.exec(themeSource)?.[1] ?? "";
    const inset = (side: string) => Number(new RegExp(`${side}: (\\d+)`).exec(place)?.[1]);
    expect(place).toContain('position: "absolute"');
    expect(place).toMatch(/bottom: \d+/);
    expect(place).not.toMatch(/\btop:/);
    const m = BLOCKS_TOAST_METRICS;
    const lineWidth = 375 - inset("left") - inset("right") - m.paddingLeft - m.paddingRightWithoutAction - m.swatchSize - m.swatchGap;
    expect(lineWidth).toBe(281);
    // A generous average advance for SF semibold (0.6 em).
    const width = (text: string, size: number) => text.length * size * 0.6;
    for (const scale of [1, m.maxFontScale]) {
      const size = m.messageFontSize * scale;
      const lead = width(switchedToastCopy("x").lead!, size);
      // "Switched to" always fits whole, with room for a name beside it.
      expect(lead + m.leadNameGap).toBeLessThan(lineWidth / 2);
      // The owner's example fits in full, with no ellipsis.
      expect(lead + m.leadNameGap + width("School run", size)).toBeLessThan(lineWidth);
      // An extremely long name cannot fit; only it gives way (the lead keeps its width).
      expect(lead + m.leadNameGap + width("Quarterly planning with the whole design and engineering group", size)).toBeGreaterThan(lineWidth);
    }
  });

  it("pops in with the prototype's spring and drops away, and only fades under Reduce Motion (X4)", () => {
    act(() => {
      tree = create(<BlocksToast message="Logged Deep work" reduceMotion={false} theme={theme} />);
    });
    expect(host().props.entering).toEqual({ kind: "entering", spring: "pop", reduceMotion: false });
    expect(host().props.exiting).toEqual({ kind: "exiting", reduceMotion: false });
    act(() => {
      tree!.update(<BlocksToast message="Logged Deep work" reduceMotion theme={theme} />);
    });
    expect(host().props.entering).toEqual({ kind: "entering", spring: null, reduceMotion: true });
    expect(host().props.exiting).toEqual({ kind: "exiting", reduceMotion: true });
  });

  it("never uses the coral accent (source guard)", () => {
    const source = readFileSync(fileURLToPath(new URL("./BlocksToast.tsx", import.meta.url)), "utf8");
    expect(source).not.toContain("theme.accent");
    expect(source).not.toContain("theme.onAccent");
  });
});

describe("useBlocksNotice", () => {
  type Notice = ReturnType<typeof useBlocksNotice>;
  function Harness({ onNotice }: { onNotice: (notice: Notice) => void }) {
    onNotice(useBlocksNotice());
    return null;
  }

  it("shows one notice for 5 s, replaces it with a newer one, and announces each", () => {
    vi.useFakeTimers();
    let notice!: Notice;
    act(() => {
      tree = create(<Harness onNotice={(value) => { notice = value; }} />);
    });
    act(() => notice.show(switchedToastCopy("Work"), "#4C8DFF"));
    const first = notice.notice!;
    expect(first.message).toBe("Switched to Work");
    expect(first.lead).toBe("Switched to");
    expect(first.name).toBe("Work");
    expect(first.accessibilityLabel).toBe("Switched to Work.");
    expect(first.swatchColor).toBe("#4C8DFF");
    act(() => { vi.advanceTimersByTime(BLOCKS_TOAST_DURATION_MS - 1_000); });
    act(() => notice.show("Already recording Work"));
    expect(notice.notice!.token).toBeGreaterThan(first.token);
    // The first notice's timer is gone: it cannot hide the newer one.
    act(() => { vi.advanceTimersByTime(1_500); });
    expect(notice.notice?.message).toBe("Already recording Work");
    expect(notice.notice?.lead).toBeNull();
    expect(notice.notice?.name).toBeNull();
    act(() => { vi.advanceTimersByTime(BLOCKS_TOAST_DURATION_MS); });
    expect(notice.notice).toBeNull();
    expect(mocks.announce.mock.calls.map(([message]) => message)).toEqual([
      "Switched to Work.",
      "Already recording Work"
    ]);
  });

  it("clears at once and ignores the cleared notice's timer", () => {
    vi.useFakeTimers();
    let notice!: Notice;
    act(() => {
      tree = create(<Harness onNotice={(value) => { notice = value; }} />);
    });
    act(() => notice.show("Quick start holds 6. Unpin one first."));
    act(() => notice.clear());
    expect(notice.notice).toBeNull();
    act(() => notice.show("Still loading your activities. Try again in a moment."));
    act(() => { vi.advanceTimersByTime(BLOCKS_TOAST_DURATION_MS - 1); });
    expect(notice.notice).not.toBeNull();
  });
});
