import { forwardRef, useImperativeHandle } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({
  blur: vi.fn(),
  dismiss: vi.fn(),
  events: [] as string[],
  focus: vi.fn(),
  keyboardDismiss: vi.fn(),
  sheetProps: null as null | Record<string, unknown>,
}));
vi.mock("react-native", async () => {
  const React = await import("react");
  return {
  ActivityIndicator: "ActivityIndicator",
  Keyboard: { dismiss: mocks.keyboardDismiss },
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "Text",
  // A host input with the native focus methods, so the sheet's focus hand-off can be observed.
  TextInput: React.forwardRef(function TextInput(props: Record<string, unknown>, ref) {
    useImperativeHandle(ref, () => ({ blur: mocks.blur, focus: mocks.focus }));
    return React.createElement("TextInput", props);
  }),
  View: "View",
  };
});
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 59 }) }));
vi.mock("./SwipeDismissSheet", async () => {
  const React = await import("react");
  return {
    // The shared presence owner: dismiss() runs its exit, which calls onDismissStart at once and
    // onDismiss only when the exit has finished (the tests call that themselves).
    SwipeDismissSheet: forwardRef(function Sheet(props: Record<string, unknown>, ref) {
      mocks.sheetProps = props;
      useImperativeHandle(ref, () => ({
        dismiss: () => {
          mocks.dismiss();
          mocks.events.push("exit-start");
          (props.onDismissStart as (() => void) | undefined)?.();
        },
      }));
      return React.createElement("Sheet", null, props.children as never);
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
  for (const fn of [mocks.blur, mocks.dismiss, mocks.focus, mocks.keyboardDismiss]) fn.mockClear();
  mocks.events.length = 0;
  mocks.blur.mockImplementation(() => mocks.events.push("blur"));
  mocks.keyboardDismiss.mockImplementation(() => mocks.events.push("keyboard-dismiss"));
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
  // Owner, TestFlight 124 (20 Oct 2026): the picker rose under a keyboard coming up with it, and on
  // Cancel the sheet slid away behind the keyboard, which stayed up until the exit spring settled.
  it("is presented by the shared SwipeDismissSheet owner and focuses search once it has landed", () => {
    const { tree } = render({ reduceMotion: true });
    expect(mocks.sheetProps).toMatchObject({ reduceMotion: true, testID: "activity-picker", visible: true });
    const input = tree.root.findByProps({ testID: "activity-picker-search" });
    expect(input.props.autoFocus).toBeUndefined();
    expect(mocks.focus).not.toHaveBeenCalled();
    act(() => (mocks.sheetProps!.onPresented as () => void)());
    expect(mocks.focus).toHaveBeenCalledOnce();
    act(() => tree.unmount());
  });

  it("drops the keyboard as Cancel starts the exit, and closes only when the exit has run", () => {
    const { props, tree } = render();
    act(() => tree.root.findByProps({ testID: "activity-picker-cancel" }).props.onPress());
    expect(mocks.events).toEqual(["exit-start", "blur", "keyboard-dismiss"]);
    // No instant unmount: the caller hears onClose only from the sheet's finished exit.
    expect(props.onClose).not.toHaveBeenCalled();
    expect(mocks.sheetProps!.onDismiss).toBe(props.onClose);
    // A late presentation callback never refocuses a leaving sheet.
    act(() => (mocks.sheetProps!.onPresented as () => void)());
    expect(mocks.focus).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("drops the keyboard on every other way out: a pick, the backdrop or a swipe", () => {
    const { tree } = render();
    act(() => tree.root.findByProps({ testID: "activity-picker-row-recent-learn" }).props.onPress());
    expect(mocks.events).toEqual(["exit-start", "blur", "keyboard-dismiss"]);
    // The backdrop, accessibility escape and a committed swipe reach the same onDismissStart.
    mocks.events.length = 0;
    act(() => (mocks.sheetProps!.onDismissStart as () => void)());
    expect(mocks.events).toEqual(["blur", "keyboard-dismiss"]);
    mocks.keyboardDismiss.mockClear();
    act(() => (mocks.sheetProps!.onGestureStart as () => void)());
    expect(mocks.keyboardDismiss).toHaveBeenCalledOnce();
    act(() => tree.unmount());
  });

  it("never picks a created activity after the picker was cancelled", async () => {
    let resolveCreate!: (value: { id: string }) => void;
    const onCreate = vi.fn(() => new Promise<{ id: string }>((resolve) => { resolveCreate = resolve; }));
    const { props, search, tree } = render({ onCreate });
    search("Pottery");
    let pending!: Promise<void>;
    act(() => {
      pending = tree.root.findByProps({ testID: "activity-picker-create" }).props.onPress();
    });
    act(() => tree.root.findByProps({ testID: "activity-picker-cancel" }).props.onPress());
    await act(async () => {
      resolveCreate({ id: "pottery" });
      await pending;
    });
    expect(props.onPick).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

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
    const onCreate = vi.fn(() => Promise.resolve({ id: "pottery" }));
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
    const { props, search, texts, tree } = render({ onCreate: vi.fn(() => Promise.resolve({ error: "An activity with that name already exists." })) });
    search("Pottery");
    await act(async () => {
      await tree.root.findByProps({ testID: "activity-picker-create" }).props.onPress();
    });
    expect(props.onPick).not.toHaveBeenCalled();
    expect(mocks.dismiss).not.toHaveBeenCalled();
    // The server's own message is shown (a name taken elsewhere is not a connection problem).
    expect(texts()).toContain("An activity with that name already exists.");
    act(() => tree.unmount());
  });
});
