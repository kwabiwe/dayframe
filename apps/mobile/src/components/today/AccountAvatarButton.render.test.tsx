import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "Text",
  View: "View",
}));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));

import { AccountAvatarButton } from "./AccountAvatarButton";

const theme = { background: "#050914", danger: "#E5484D", surfaceMuted: "#202838", textPrimary: "#F7F8FB" } as never;

describe("AccountAvatarButton", () => {
  it("opens Settings without attention, and Sync help with a badge while a change needs the user", () => {
    const onPress = vi.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<AccountAvatarButton email="qa@example.com" name="QA Today" onPress={onPress} theme={theme} />);
    });
    const avatar = () => tree.root.findByProps({ testID: "account-avatar" });
    expect(avatar().props.accessibilityLabel).toBe("Account and settings");
    expect(tree.root.findAllByProps({ testID: "account-avatar-attention" })).toHaveLength(0);
    act(() => avatar().props.onPress());
    act(() => {
      tree.update(<AccountAvatarButton attentionCount={2} email="qa@example.com" name="QA Today" onPress={onPress} theme={theme} />);
    });
    expect(avatar().props.accessibilityLabel).toBe("Account and settings. 2 changes couldn't be saved and need your attention.");
    expect(avatar().props.accessibilityHint).toBe("Opens Sync help in Settings");
    expect(tree.root.findByProps({ testID: "account-avatar-attention" }).props.style[1]).toEqual({ backgroundColor: "#E5484D", borderColor: "#050914" });
    act(() => avatar().props.onPress());
    expect(onPress.mock.calls).toEqual([["settings"], ["sync"]]);
  });
});
