import { forwardRef, useImperativeHandle } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({ dismiss: vi.fn() }));
vi.mock("react-native", () => ({
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 0.5 },
  Text: "Text",
  View: "View",
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 59 }) }));
vi.mock("../SwipeDismissSheet", async () => {
  const React = await import("react");
  return {
    SwipeDismissSheet: forwardRef(function Sheet({ children }: { children: unknown }, ref) {
      useImperativeHandle(ref, () => ({ dismiss: mocks.dismiss }));
      return React.createElement("Sheet", null, children as never);
    }),
  };
});
vi.mock("../icons/DayframeIcon", () => ({ DayframeIcon: () => null }));
vi.mock("./ActivityBlockMark", () => ({ ActivityBlockMark: () => null }));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));

import { TodaySwitchSheet } from "./TodaySwitchSheet";

const theme = { border: "#333", textMuted: "#777", textPrimary: "#fff", textSecondary: "#aaa" } as never;
const now = new Date("2026-10-07T21:00:00").getTime();
const recent = (id: string, title: string) => ({
  entry: { categoryId: "work", categoryName: "Work", description: title, id, startedAt: "2026-10-06T09:00:00", stoppedAt: "2026-10-06T10:00:00" } as never,
  title,
});

function render(recents: ReturnType<typeof recent>[]) {
  const props = { activityIconFor: () => null, nowMs: now, onClose: vi.fn(), onPick: vi.fn(), recents, reduceMotion: false, running: true, styles: {} as never, theme };
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<TodaySwitchSheet {...props} />);
  });
  return { props, tree };
}

describe("TodaySwitchSheet", () => {
  it("lists recent blocks and starts the one picked, once, as the sheet leaves", () => {
    mocks.dismiss.mockClear();
    const { props, tree } = render([recent("a", "Deep work"), recent("b", "Inbox zero")]);
    const texts = tree.root.findAllByType("Text" as never).map((node) => node.children.join(""));
    expect(texts).toEqual(["SWITCH", "Pick up something recent", "Deep work", "Work · yesterday", "Inbox zero", "Work · yesterday"]);
    const row = tree.root.findByProps({ testID: "today-switch-b" });
    expect(row.props.accessibilityLabel).toBe("Switch to Inbox zero, Work, yesterday");
    act(() => row.props.onPress());
    act(() => tree.root.findByProps({ testID: "today-switch-a" }).props.onPress());
    expect(props.onPick).toHaveBeenCalledOnce();
    expect(props.onPick.mock.calls[0][0].id).toBe("b");
    expect(mocks.dismiss).toHaveBeenCalledOnce();
    act(() => tree.unmount());
  });

  it("says Start, not Switch, once the running block has stopped elsewhere", () => {
    const props = { activityIconFor: () => null, nowMs: now, onClose: vi.fn(), onPick: vi.fn(), recents: [recent("a", "Deep work")], reduceMotion: false, running: false, styles: {} as never, theme };
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<TodaySwitchSheet {...props} />);
    });
    const row = tree.root.findByProps({ testID: "today-switch-a" });
    expect(row.props.accessibilityLabel).toBe("Start Deep work, Work, yesterday");
    expect(row.props.accessibilityHint).toBe("Starts this block");
    act(() => tree.unmount());
  });

  it("explains what will appear when nothing recent has a description", () => {
    const { tree } = render([]);
    const texts = tree.root.findAllByType("Text" as never).map((node) => node.children.join(""));
    expect(texts).toContain("Finished blocks with a description show up here.");
    act(() => tree.unmount());
  });
});
