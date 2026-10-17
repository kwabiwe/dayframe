import { forwardRef, useImperativeHandle } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({ dismiss: vi.fn(), sheetProps: null as null | Record<string, (...args: never[]) => unknown> }));
vi.mock("react-native", () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  useWindowDimensions: () => ({ width: 375, height: 812, fontScale: 1 })
}));
vi.mock("react-native-maps", () => ({ default: "MapView", Circle: "MapCircle" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 59 }) }));
vi.mock("../SwipeDismissSheet", async () => {
  const React = await import("react");
  return {
    SwipeDismissSheet: forwardRef(function Sheet(props: { children?: unknown }, ref) {
      mocks.sheetProps = props as never;
      useImperativeHandle(ref, () => ({ dismiss: mocks.dismiss }));
      return React.createElement("Sheet", null, props.children as never);
    })
  };
});
vi.mock("../blocks/BlocksSheetHead", async () => {
  const React = await import("react");
  return {
    BlocksSheetHead: ({ action }: { action: { label: string; onPress: () => void } }) =>
      React.createElement("Pressable", { onPress: action.onPress, testID: "save-place-save" }, action.label)
  };
});
vi.mock("../settings/SettingsBlocks", async () => {
  const React = await import("react");
  return { SettingsSwitch: (props: Record<string, unknown>) => React.createElement("Switch", props) };
});
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));

const { SavePlaceSheet } = await import("./SavePlaceSheet");

const theme = { border: "#333", dangerText: "#f55", surfaceInset: "#111", surfaceRaised: "#222", textMuted: "#777", textPrimary: "#fff", textSecondary: "#aaa" } as never;

function render(onSave = vi.fn(async () => null as string | null)) {
  mocks.dismiss.mockClear();
  const props = { centre: { latitude: 10, longitude: 20 }, initialName: "Example Bakery", logsAs: "Training", onClose: vi.fn(), onSave, onSaved: vi.fn(),
    reduceMotion: false, styles: {} as never, theme };
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<SavePlaceSheet {...props} />); });
  const byTestId = (id: string) => tree.root.find((node) => node.props.testID === id && typeof node.type === "string");
  const switchFor = (label: string) => tree.root.find((node) => (node.type as unknown) === "Switch" && node.props.label === label);
  return { byTestId, props, switchFor, tree };
}

describe("SavePlaceSheet (PRD D19, design §7)", () => {
  it("saves the name, size and switches once, then leaves before the screen changes the row", async () => {
    let finish!: (value: string | null) => void;
    const onSave = vi.fn(() => new Promise<string | null>((resolve) => { finish = resolve; }));
    const { byTestId, props, switchFor } = render(onSave);
    act(() => byTestId("save-place-name").props.onChangeText("Bakery corner"));
    act(() => byTestId("save-place-size-large").props.onPress());
    expect(byTestId("save-place-map").props.accessibilityLabel).toContain("200 metre");
    act(() => switchFor("Log automatically").props.onValueChange(true));
    let pending!: Promise<void>;
    act(() => { pending = byTestId("save-place-save").props.onPress(); });
    // One-shot: a second tap while saving does nothing.
    act(() => { void byTestId("save-place-save").props.onPress(); });
    await act(async () => { finish(null); await pending; });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ name: "Bakery corner", radiusMeters: 200, suggestVisits: true, autoLog: true });
    expect(mocks.dismiss).toHaveBeenCalledTimes(1);
    expect(props.onSaved).not.toHaveBeenCalled();
    act(() => { mocks.sheetProps!.onDismiss(); });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSaved).toHaveBeenCalledWith({ name: "Bakery corner", radiusMeters: 200, suggestVisits: true, autoLog: true });
  });

  it("keeps the draft with the reason when the save is refused, and turns Log automatically off with suggestions", async () => {
    const { byTestId, props, switchFor } = render(vi.fn(async () => "This place is already being saved."));
    act(() => switchFor("Log automatically").props.onValueChange(true));
    act(() => switchFor("Suggest visits here").props.onValueChange(false));
    expect(switchFor("Log automatically").props).toMatchObject({ value: false, disabled: true });
    await act(async () => { await byTestId("save-place-save").props.onPress(); });
    expect(byTestId("save-place-problem").children.join("")).toBe("This place is already being saved.");
    expect(byTestId("save-place-name").props.value).toBe("Example Bakery");
    expect(mocks.dismiss).not.toHaveBeenCalled();
    // A dismissal without a save never reports one.
    act(() => { mocks.sheetProps!.onDismiss(); });
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it("asks for a name rather than saving an empty one", async () => {
    const { byTestId, props } = render();
    act(() => byTestId("save-place-name").props.onChangeText("   "));
    await act(async () => { await byTestId("save-place-save").props.onPress(); });
    expect(props.onSave).not.toHaveBeenCalled();
    expect(byTestId("save-place-problem").children.join("")).toBe("Give this place a name.");
  });
});
