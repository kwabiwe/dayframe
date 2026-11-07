import { forwardRef, useImperativeHandle } from "react";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const keyboard = vi.hoisted(() => ({
  dismiss: vi.fn(),
  freezeForDismissal: vi.fn(),
  keyboardInset: 0,
  keyboardSpace: { value: 0 },
  onScrollLayout: vi.fn(),
  revealWhenSettled: vi.fn(),
  sheetMaxHeight: 680
}));
vi.mock("react-native", () => ({
  AccessibilityInfo: { announceForAccessibility: () => undefined },
  Keyboard: { dismiss: keyboard.dismiss },
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  useWindowDimensions: () => ({ height: 800, width: 390 })
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: "ReanimatedView" },
  LayoutAnimationConfig: ({ children }: { children: unknown }) => children,
  useAnimatedStyle: (style: () => unknown) => style()
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 59 }) }));
vi.mock("../SwipeDismissSheet", async () => {
  const React = await import("react");
  return {
    SwipeDismissSheet: forwardRef(function Sheet(props: Record<string, unknown>, ref) {
      useImperativeHandle(ref, () => ({ dismiss: () => {
        if ((props.onDismissStart as () => boolean | void)() !== false) (props.onDismiss as () => void)();
      } }));
      return React.createElement("Sheet", props, props.children as never);
    })
  };
});
vi.mock("../blocks/BlocksSheetHead", async () => {
  const React = await import("react");
  return { BlocksSheetHead: (props: { action: Record<string, unknown> }) => React.createElement("Head", props.action) };
});
vi.mock("../icons/DayframeIcon", () => ({ DayframeIcon: () => null }));
vi.mock("../settings/SettingsBlocks", async () => {
  const React = await import("react");
  return {
    SettingsBlockRow: (props: { control: unknown; subtitle?: string; title: string }) =>
      React.createElement("Row", { subtitle: props.subtitle, title: props.title }, props.control as never),
    SettingsSwitch: (props: { label: string; onValueChange: (value: boolean) => void; value: boolean }) =>
      React.createElement("Switch", props)
  };
});
vi.mock("../../lib/motion", () => ({ localLayoutTransition: () => null, localPresenceEntering: () => null, localPresenceExiting: () => null }));
vi.mock("../../lib/contentSizedSheetKeyboard", () => ({ useContentSizedSheetKeyboard: () => keyboard }));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}), MOBILE_DISPLAY_FONT: { bold: "Display" } }));

const { PlaceRoleSheet } = await import("./PlaceRoleSheet");
const theme = { border: "#333", dangerText: "#f55", surface: "#000", surfaceInset: "#111", surfaceMuted: "#222", textMuted: "#777", textPrimary: "#fff", textSecondary: "#aaa" } as never;
const styles = { activeEditSheet: { paddingBottom: 10 } } as never;
// Synthetic coordinates: at latitude 10, 0.001° of latitude is about 111 m.
const oldHome = { id: "p-home", name: "Example Flat", role: "home" as const, radiusMeters: 100, latitude: 10, longitude: 20 };
const near = { id: "p-near", name: "Example Studio", role: null, radiusMeters: 100, latitude: 10.002, longitude: 20 };
const far = { id: "p-far", name: "Example Office", role: null, radiusMeters: 100, latitude: 10.01, longitude: 20 };

let tree: ReturnType<typeof create> | undefined;
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  keyboard.keyboardInset = 0;
  keyboard.keyboardSpace.value = 0;
  vi.clearAllMocks();
});
const find = (type: string) => tree!.root.findAll((node: ReactTestInstance) => (node.type as unknown) === type);
const byTestID = (testID: string) => tree!.root.findAll((node: ReactTestInstance) => node.props.testID === testID && typeof node.type === "string");

type SheetPlace = { id: string; name: string; role: "home" | "work" | null; radiusMeters: number; latitude: number | null; longitude: number | null };

function render(places: SheetPlace[] = [oldHome, near, far], mode: "choose" | "clear" = "choose") {
  const onSave = vi.fn(() => Promise.resolve(null));
  act(() => {
    tree = create(
      <PlaceRoleSheet
        mode={mode}
        onAddNew={() => undefined}
        onClose={() => undefined}
        onSave={onSave}
        places={places}
        reduceMotion={false}
        slot={{ role: "home", label: "Home", place: places[0], secondary: places[0].name, previousHolder: places[0], namedLikeRole: [] }}
        styles={styles}
        theme={theme}
      />
    );
  });
  return onSave;
}

async function choose(id: string) {
  await act(async () => byTestID(`place-role-choice-${id}`)[0].props.onPress());
}

async function save() {
  await act(async () => { await (find("Head")[0].props.onPress as () => Promise<void>)(); });
}

describe("Home and Work sheet › Replace the old place (PRD D19 A10)", () => {
  it("reserves the keyboard space inside Clear and freezes it when a rename is saved", async () => {
    keyboard.keyboardInset = 260;
    keyboard.keyboardSpace.value = 256;
    const onSave = render(undefined, "clear");
    const sheet = find("Sheet")[0];
    expect(sheet.props.keyboardInset).toBe(260);
    expect(sheet.props.style[1]).toEqual({ height: 656, paddingBottom: 266 });
    const input = byTestID("place-role-previous-name")[0];
    act(() => {
      input.props.onFocus();
      input.props.onChangeText("Renamed home");
    });
    expect(keyboard.revealWhenSettled).toHaveBeenCalledOnce();
    await save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ role: "home", placeId: null, previousPlaceName: "Renamed home" }));
    expect(keyboard.freezeForDismissal).toHaveBeenCalledOnce();
    expect(keyboard.dismiss).toHaveBeenCalledOnce();
  });

  it("offers it, on, when the new Home is within 300 m of the old one, and asks to archive it", async () => {
    const onSave = render();
    expect(byTestID("place-role-replace")).toHaveLength(0);
    await choose(near.id);
    const row = find("Row")[0];
    expect(row.props.title).toBe("Replace the old place");
    expect(row.props.subtitle).toBe("Your old Home is close by; archive it so the two don't overlap. You can restore it from Places.");
    expect(find("Switch")[0].props.value).toBe(true);
    await save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ role: "home", placeId: near.id, archivePrevious: true }));
  });

  it("keeps the old place when the person turns it off", async () => {
    const onSave = render();
    await choose(near.id);
    act(() => find("Switch")[0].props.onValueChange(false));
    await save();
    expect(onSave).toHaveBeenCalledWith(expect.not.objectContaining({ archivePrevious: true }));
  });

  it("offers nothing for a new Home farther than 300 m, or when the old one has no coordinates", async () => {
    const onSave = render();
    await choose(far.id);
    expect(byTestID("place-role-replace")).toHaveLength(0);
    await save();
    expect(onSave).toHaveBeenCalledWith(expect.not.objectContaining({ archivePrevious: true }));
    act(() => tree!.unmount());
    render([{ ...oldHome, latitude: null, longitude: null }, near, far]);
    await choose(near.id);
    expect(byTestID("place-role-replace")).toHaveLength(0);
  });
});
