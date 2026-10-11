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
vi.mock("react-native-reanimated", () => ({ default: { View: "ReanimatedView" } }));
vi.mock("../../lib/blocksMotion", () => ({
  blocksToastEntering: (reduceMotion: boolean) => ({ kind: "entering", spring: reduceMotion ? null : "pop", reduceMotion }),
  blocksToastExiting: (reduceMotion: boolean) => ({ kind: "exiting", reduceMotion })
}));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));

const { BLOCKS_TOAST_DURATION_MS, BlocksToast, useBlocksNotice } = await import("./BlocksToast");

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
    expect(flatStyle(host()).borderRadius).toBe(999);
    expect(host().props.accessibilityLiveRegion).toBe("polite");
    expect(texts()).toEqual(["Deleted Deep work", "Undo"]);
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
    act(() => notice.show("Switched to Work · 42m logged to Client Work", "#4C8DFF"));
    const first = notice.notice!;
    expect(first.message).toBe("Switched to Work · 42m logged to Client Work");
    expect(first.swatchColor).toBe("#4C8DFF");
    act(() => { vi.advanceTimersByTime(BLOCKS_TOAST_DURATION_MS - 1_000); });
    act(() => notice.show("Already recording Work"));
    expect(notice.notice!.token).toBeGreaterThan(first.token);
    // The first notice's timer is gone: it cannot hide the newer one.
    act(() => { vi.advanceTimersByTime(1_500); });
    expect(notice.notice?.message).toBe("Already recording Work");
    act(() => { vi.advanceTimersByTime(BLOCKS_TOAST_DURATION_MS); });
    expect(notice.notice).toBeNull();
    expect(mocks.announce.mock.calls.map(([message]) => message)).toEqual([
      "Switched to Work · 42m logged to Client Work",
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
