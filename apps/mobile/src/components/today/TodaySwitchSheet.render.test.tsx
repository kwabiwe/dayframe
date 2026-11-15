import type { ComponentProps, ReactNode } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  Keyboard: { dismiss: vi.fn() },
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 0.5 },
  Text: "Text",
  TextInput: "TextInput",
  useWindowDimensions: () => ({ fontScale: 1.6 }),
  View: "View",
}));
vi.mock("../sheets/BottomSheetShell", async () => {
  const React = await import("react");
  return {
    BottomSheetShell: ({ action, children, disabled, fixedHeader, onApply }: {
      action: string;
      children: ReactNode;
      disabled: boolean;
      fixedHeader: ReactNode;
      onApply: () => void;
    }) => {
      return React.createElement("SwitchHarness", { action, disabled, onPress: disabled ? undefined : onApply }, fixedHeader, children);
    },
  };
});
vi.mock("../icons/DayframeIcon", () => ({ DayframeIcon: () => null }));
vi.mock("./ActivityBlockMark", () => ({ ActivityBlockMark: () => null }));
vi.mock("../../lib/mobileTypography", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/mobileTypography")>(),
  mobileTextProps: () => ({}),
}));

import { TodaySwitchSheet } from "./TodaySwitchSheet";

type SwitchProps = ComponentProps<typeof TodaySwitchSheet>;
const theme = { border: "#333", textMuted: "#777", textPrimary: "#fff", textSecondary: "#aaa" } as never;
const now = new Date("2026-10-07T21:00:00").getTime();
const recent = (id: string, title: string) => ({
  entry: { categoryId: "work", categoryName: "Work", description: title, id, startedAt: "2026-10-06T09:00:00", stoppedAt: "2026-10-06T10:00:00", tagNames: ["Planning"] } as never,
  title,
});

function render(recents: SwitchProps["recents"], extra: Partial<SwitchProps> = {}) {
  const onCommit = vi.fn();
  const props = { activityIconFor: () => null, candidates: [], nowMs: now, onClose: vi.fn(), onCommit, recents, reduceMotion: false, running: true, styles: {} as never, theme, ...extra };
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<TodaySwitchSheet {...props} />);
  });
  return {
    onCommit,
    tree,
    shell: () => tree.root.findByType("SwitchHarness" as never),
    input: () => tree.root.findByProps({ testID: "today-switch-description" }),
  };
}

describe("TodaySwitchSheet", () => {
  it("holds a recent choice and its tags until the shared commit", () => {
    const { tree, shell, onCommit, input } = render([recent("a", "Deep work"), recent("b", "Inbox zero")]);
    const card = tree.root.findByProps({ testID: "today-switch-card" });
    const reserved = tree.root.findByProps({ testID: "today-switch-results" }).props.style.minHeight;
    expect(reserved).toBeGreaterThan(3 * 56);
    expect(card.findAllByProps({ testID: "today-switch-a" })).toHaveLength(1);
    expect(shell().props.disabled).toBe(true);
    expect(input().props.onSubmitEditing).toBeUndefined();
    act(() => tree.root.findByProps({ testID: "today-switch-b" }).props.onPress());
    expect(onCommit).not.toHaveBeenCalled();
    expect(input().props.value).toBe("Inbox zero");
    expect(tree.root.findByProps({ testID: "today-switch-results" }).props.style.minHeight).toBe(reserved);
    expect(shell().props.action).toBe("Switch to this block");
    act(() => shell().props.onPress());
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("work", "Inbox zero", ["Planning"]);
    act(() => tree.unmount());
  });

  it("finds a historical candidate outside recents and drops its metadata after editing the query", () => {
    const { onCommit, tree, shell, input } = render([recent("a", "Deep work")], { candidates: [{
      categoryColor: null, categoryId: "coding", categoryName: "Coding", description: "Fix joining",
      key: "old", lastSeenAt: "2026-09-28T09:00:00Z", learningTier: 1, score: 10,
      section: "recent", tagNames: ["Release"], totalSeconds: 300, useCount: 1,
    }] });
    act(() => input().props.onChangeText("join"));
    expect(tree.root.findAllByProps({ testID: "today-switch-a" })).toHaveLength(0);
    act(() => tree.root.findByProps({ testID: "today-switch-old" }).props.onPress());
    expect(input().props.value).toBe("Fix joining");
    act(() => shell().props.onPress());
    expect(onCommit).toHaveBeenLastCalledWith("coding", "Fix joining", ["Release"]);
    act(() => input().props.onChangeText("Fix the next issue "));
    expect(shell().props.action).toBe("Switch to new block");
    act(() => shell().props.onPress());
    expect(onCommit).toHaveBeenLastCalledWith(null, "Fix the next issue", undefined);
    act(() => tree.unmount());
  });

  it("offers Start once the running block has stopped elsewhere", () => {
    const { tree, shell } = render([recent("a", "Deep work")], { running: false });
    expect(shell().props.action).toBe("Start new block");
    act(() => tree.root.findByProps({ testID: "today-switch-a" }).props.onPress());
    expect(shell().props.action).toBe("Start this block");
    act(() => tree.unmount());
  });

  it("matches a visible recent when the historical pool is absent", () => {
    const { tree, onCommit, input, shell } = render([recent("a", "Short handover")]);
    act(() => input().props.onChangeText("short"));
    act(() => tree.root.findByProps({ testID: "today-switch-a" }).props.onPress());
    act(() => shell().props.onPress());
    expect(onCommit).toHaveBeenCalledWith("work", "Short handover", ["Planning"]);
    act(() => tree.unmount());
  });
});
