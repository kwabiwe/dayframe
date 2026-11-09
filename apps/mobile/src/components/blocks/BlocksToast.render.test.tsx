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
  blocksToastExiting: (reduceMotion: boolean) => ({ kind: "exiting", reduceMotion }),
  blocksToastLayout: (reduceMotion: boolean) => (reduceMotion ? undefined : { kind: "layout" })
}));
vi.mock("../../lib/motion", () => ({
  localPresenceEntering: (reduceMotion: boolean) => ({ kind: "contentFade", reduceMotion })
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

// The pill is the outermost Reanimated view (its content is another, keyed by what it says).
const host = () => tree!.root.findAll((node: ReactTestInstance) => (node.type as unknown) === "ReanimatedView")[0];
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

  it("shows the switch as two lines, the detail muted, read by VoiceOver as one sentence", () => {
    const copy = switchedToastCopy("School run", {
      categoryName: "Family", description: "Breakfast", startedAt: "2026-10-14T08:00:00.000Z"
    }, Date.parse("2026-10-14T08:00:40.000Z"));
    act(() => {
      tree = create(
        <BlocksToast
          accessibilityLabel={copy.accessibilityLabel}
          detail={copy.detail}
          message={copy.message}
          reduceMotion={false}
          swatchColor="#4C8DFF"
          testID="toast"
          theme={theme}
        />
      );
    });
    expect(texts()).toEqual(["Switched to School run", "<1m logged to Breakfast"]);
    const label = byTestId("toast-label");
    expect(label.props.accessible).toBe(true);
    expect(label.props.accessibilityLabel).toBe("Switched to School run, less than a minute logged to Breakfast.");
    // Line 2 is muted: the inverse text colour at reduced opacity, never the accent.
    expect(flatStyle(byTestId("toast-detail")).color).toBe("rgba(5, 9, 20, 0.72)");
    expect(flatStyle(byTestId("toast-message")).color).toBe("#050914");
    expect(flatStyle(byTestId("toast-detail")).fontSize).toBeLessThan(flatStyle(byTestId("toast-message")).fontSize);
    // The entrance and exit are the toast's own, whatever its height.
    expect(host().props.entering).toEqual({ kind: "entering", spring: "pop", reduceMotion: false });
  });

  it("lets both lines wrap instead of truncating to one line", () => {
    act(() => {
      tree = create(<BlocksToast detail="42m logged to Client Work" message="Switched to Work" reduceMotion={false} testID="toast" theme={theme} />);
    });
    const message = byTestId("toast-message");
    const detail = byTestId("toast-detail");
    expect(message.props.numberOfLines).toBeGreaterThanOrEqual(2);
    expect(detail.props.numberOfLines).toBeGreaterThanOrEqual(2);
    // No fixed height anywhere: the toast grows with its lines (minimum 52 points, never a cap).
    for (const node of [host(), byTestId("toast-label"), message, detail]) {
      expect(flatStyle(node).height).toBeUndefined();
      expect(flatStyle(node).maxHeight).toBeUndefined();
    }
    expect(flatStyle(host()).minHeight).toBe(52);
  });

  it("fits \"Switched to School run\" on one line at 375 points, even at the largest text size (Trello \"That message is too long\")", () => {
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
    // A generous average advance for SF semibold (0.6 em) at the capped Dynamic Type size.
    const width = (text: string, size: number) => text.length * size * 0.6;
    expect(width("Switched to School run", m.messageFontSize * m.maxFontScale)).toBeLessThan(lineWidth);
    expect(width("<1m logged to Client Work", m.detailFontSize * m.maxFontScale)).toBeLessThan(lineWidth);
    // The owner's old single line could never fit, even at the default size.
    expect(width("Switched to School run · under a minute logged to Client Work", m.messageFontSize)).toBeGreaterThan(lineWidth);
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

  // Codex r3 on #532: a group delete that loses a refused member changes the mounted toast's words
  // ("Deleted 2 blocks" to "Deleted Deep work") under the same key, deadline and Undo.
  it("owns a content update: the new words fade in and the pill's layout transition carries the size", () => {
    const onUndo = vi.fn();
    const render = (message: string, swatchColor: string | null, reduceMotion = false) => (
      <BlocksToast actionLabel="Undo" actionTestID="toast-undo" message={message} onAction={onUndo}
        reduceMotion={reduceMotion} swatchColor={swatchColor} testID="toast" theme={theme} />
    );
    act(() => { tree = create(render("Deleted 2 blocks", null)); });
    const pill = host();
    // The toast's own frame-only transition (BlocksToast.lifecycle.test.tsx plays it through an entrance).
    expect(pill.props.layout).toEqual({ kind: "layout" });
    // The first words never fade: the entrance is the only motion on mount.
    expect(byTestId("toast-content").props.entering).toBeUndefined();

    act(() => tree!.update(render("Deleted Deep work", "#4C8DFF")));
    // The same pill (not re-mounted: no second entrance, no exit), the new words fading in.
    expect(host()).toBe(pill);
    expect(byTestId("toast-content").props.entering).toEqual({ kind: "contentFade", reduceMotion: false });
    expect(texts()).toEqual(["Deleted Deep work", "Undo"]);
    expect(flatStyle(byTestId("toast-swatch")).backgroundColor).toBe("#4C8DFF");
    expect(byTestId("toast-label").props.accessibilityLabel).toBe("Deleted Deep work");
    // Undo is the same action.
    act(() => byTestId("toast-undo").props.onPress());
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("swaps a content update at once under Reduce Motion", () => {
    const render = (message: string) => (
      <BlocksToast actionLabel="Undo" message={message} onAction={vi.fn()} reduceMotion testID="toast" theme={theme} />
    );
    act(() => { tree = create(render("Deleted 2 blocks")); });
    // No layout transition at all: the size settles at once.
    expect(host().props.layout).toBeUndefined();
    act(() => tree!.update(render("Deleted Deep work")));
    expect(byTestId("toast-content").props.entering).toBeUndefined();
    expect(texts()).toEqual(["Deleted Deep work", "Undo"]);
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
    act(() => notice.show({
      accessibilityLabel: "Switched to Work, 42 minutes logged to Client Work.",
      detail: "42m logged to Client Work",
      message: "Switched to Work"
    }, "#4C8DFF"));
    const first = notice.notice!;
    expect(first.message).toBe("Switched to Work");
    expect(first.detail).toBe("42m logged to Client Work");
    expect(first.swatchColor).toBe("#4C8DFF");
    act(() => { vi.advanceTimersByTime(BLOCKS_TOAST_DURATION_MS - 1_000); });
    act(() => notice.show("Already recording Work"));
    expect(notice.notice!.token).toBeGreaterThan(first.token);
    // The first notice's timer is gone: it cannot hide the newer one.
    act(() => { vi.advanceTimersByTime(1_500); });
    expect(notice.notice?.message).toBe("Already recording Work");
    expect(notice.notice?.detail).toBeNull();
    act(() => { vi.advanceTimersByTime(BLOCKS_TOAST_DURATION_MS); });
    expect(notice.notice).toBeNull();
    expect(mocks.announce.mock.calls.map(([message]) => message)).toEqual([
      "Switched to Work, 42 minutes logged to Client Work.",
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

  it("adds a second action on its own 44-point row and replaces it with its outcome in place (PRD D19)", () => {
    const onSecondary = vi.fn();
    const render = (done: string | null) => (
      <BlocksToast
        actionLabel="Undo"
        message="Deleted Commute"
        onAction={vi.fn()}
        reduceMotion={false}
        secondary={{ label: "Don’t log trips like this", onAction: onSecondary, done, testID: "toast-trip" }}
        testID="toast"
        theme={theme}
      />
    );
    act(() => { tree = create(render(null)); });
    expect(flatStyle(host()).flexDirection).toBe("column");
    const button = byTestId("toast-trip");
    expect(flatStyle(button).minHeight).toBe(44);
    act(() => button.props.onPress());
    expect(onSecondary).toHaveBeenCalledTimes(1);
    act(() => tree!.update(render("Trips like this will be asked in Calendar.")));
    expect(texts()).toContain("Trips like this will be asked in Calendar.");
    expect(tree!.root.findAll((node: ReactTestInstance) => node.props.testID === "toast-trip" && typeof node.type === "string")).toHaveLength(0);
    // Undo is still there.
    expect(texts()).toContain("Undo");
  });

  it("keeps a toast without a second action exactly as before", () => {
    act(() => {
      tree = create(<BlocksToast actionLabel="Undo" message="Deleted Deep work" onAction={vi.fn()} reduceMotion={false} testID="toast" theme={theme} />);
    });
    expect(flatStyle(host()).flexDirection).toBe("row");
    expect(host().children.filter((child) => typeof child !== "string")).toHaveLength(2);
  });
});
