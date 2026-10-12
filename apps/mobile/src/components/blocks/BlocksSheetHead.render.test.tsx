import { readFileSync } from "node:fs";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(value: T) => value },
  Text: "Text",
  View: "View"
}));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));

const { BlocksSheetHead } = await import("./BlocksSheetHead");
const theme = {
  accent: "coral", dangerText: "red", onAccent: "ink", surfaceMuted: "muted", textMuted: "dim", textPrimary: "white"
} as never;

describe("BlocksSheetHead (UIA-006)", () => {
  it("shows the eyebrow, a header title and one right pill", () => {
    const onPress = vi.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<BlocksSheetHead action={{ label: "Save", onPress, testID: "save", tone: "primary" }} eyebrow="NEW" theme={theme} title="New activity" />);
    });
    const texts = tree.root.findAllByType("Text" as never);
    expect(texts.map((node) => node.children.join(""))).toEqual(["NEW", "New activity", "Save"]);
    expect(texts[1].props.accessibilityRole).toBe("header");
    const pill = tree.root.findByProps({ testID: "save" });
    expect(pill.props.accessibilityRole).toBe("button");
    act(() => pill.props.onPress());
    expect(onPress).toHaveBeenCalledOnce();
    expect(JSON.stringify(pill.props.style({ pressed: false }))).toContain("coral");
    act(() => tree.unmount());
  });

  it("blocks a busy save without a spinner and drops the pill when there is no action", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<BlocksSheetHead action={{ busy: true, label: "Saving…", onPress: vi.fn(), testID: "save" }} eyebrow="E" theme={theme} title="T" />);
    });
    const pill = tree.root.findByProps({ testID: "save" });
    expect(pill.props.disabled).toBe(true);
    expect(pill.props.accessibilityState).toEqual({ busy: true, disabled: true });
    act(() => tree.update(<BlocksSheetHead eyebrow="E" theme={theme} title="T" />));
    expect(tree.root.findAllByType("Pressable" as never)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("is the head of every editing sheet, with no Cancel text", () => {
    for (const file of ["../settings/ActivityEditorSheet.tsx", "../places/PlaceRoleSheet.tsx", "../today/TodaySwitchSheet.tsx", "../../../app/place-editor.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).toContain("<BlocksSheetHead");
      expect(source, file).not.toContain(">Cancel</Text>");
    }
  });
});
