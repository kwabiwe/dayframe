import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({ Pressable: "Pressable", StyleSheet: { create: <T,>(styles: T) => styles }, Text: "Text", View: "View" }));
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" } }));
vi.mock("../../lib/motion", () => ({ localPresenceEntering: () => undefined, localPresenceExiting: () => undefined }));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));

import { BlockQuestionCard, type BlockQuestion } from "./BlockQuestionCard";

const theme = { surface: "#111", surfaceMuted: "#222", textPrimary: "#FFF", textSecondary: "#AAA" } as never;
// Location v4 design §7, synthetic words.
const question = (onAnswer = vi.fn()): BlockQuestion => ({ text: "Team sync ran 18m into your trip", endLabel: "End it at 10:42", keepLabel: "Keep it", onAnswer });

function render(props: Partial<Parameters<typeof BlockQuestionCard>[0]> = {}) {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<BlockQuestionCard question={question()} reduceMotion={false} theme={theme} {...props} />); });
  return tree;
}

describe("a block's own \"?\" on its sheet (location v4 design §7)", () => {
  it("asks with one Yes (End it) and Keep it, read as needing a look", () => {
    const onAnswer = vi.fn();
    const tree = render({ question: question(onAnswer) });
    expect(tree.root.findByProps({ accessibilityLabel: "Team sync ran 18m into your trip. Needs a look" })).toBeTruthy();
    act(() => { tree.root.findByProps({ testID: "time-entry-sheet-question-end" }).props.onPress(); });
    act(() => { tree.root.findByProps({ testID: "time-entry-sheet-question-keep" }).props.onPress(); });
    expect(onAnswer.mock.calls).toEqual([[true], [false]]);
  });

  it("offers Keep it alone without End it", () => {
    const tree = render({ question: { ...question(), endLabel: null } });
    expect(tree.root.findAllByProps({ testID: "time-entry-sheet-question-end" })).toHaveLength(0);
  });

  it("waits for unsaved edits: the answers are disabled and ask to save or discard, never dropping the draft (Codex r1 on #618)", () => {
    const onAnswer = vi.fn();
    const onLocked = vi.fn();
    const tree = render({ locked: true, onLocked, question: question(onAnswer) });
    const end = tree.root.findByProps({ testID: "time-entry-sheet-question-end" });
    expect(end.props.accessibilityState).toEqual({ disabled: true });
    expect(tree.root.findAllByProps({ testID: "time-entry-sheet-question-locked" })).toHaveLength(1);
    act(() => { end.props.onPress(); });
    act(() => { tree.root.findByProps({ testID: "time-entry-sheet-question-keep" }).props.onPress(); });
    expect(onAnswer).not.toHaveBeenCalled();
    expect(onLocked).toHaveBeenCalledTimes(2);
  });
});
