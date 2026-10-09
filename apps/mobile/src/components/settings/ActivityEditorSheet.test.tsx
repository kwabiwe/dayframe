import { act, create, type ReactTestInstance } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const announce = vi.fn();
const alert = vi.fn();
vi.mock("react-native", () => ({
  AccessibilityInfo: { announceForAccessibility: (message: string) => announce(message) },
  Alert: { alert: (...args: unknown[]) => alert(...args) },
  Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Switch: "Switch",
  Text: "Text", TextInput: "TextInput", View: "View",
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  useWindowDimensions: () => ({ fontScale: 1, width: 320, height: 640 })
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock("react-native-svg", () => ({ default: "Svg", Circle: "Circle", Ellipse: "Ellipse", G: "G", Line: "Line", Path: "Path", Polygon: "Polygon", Polyline: "Polyline", Rect: "Rect" }));
vi.mock("../SwipeDismissSheet", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  const React = await import("../../../../../node_modules/react/index.js");
  return {
    SwipeDismissSheet: React.forwardRef(({ children, onDismiss }: { children: unknown; onDismiss: () => void }, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({ dismiss: onDismiss }));
      return React.createElement("Sheet", null, children);
    })
  };
});
vi.mock("../../lib/mobileTypography", () => import("../../lib/mobileTypography"));

const { ActivityEditorSheet } = await import("./ActivityEditorSheet");

const theme = {
  mode: "dark", accent: "accent", onAccent: "onAccent", textPrimary: "primary", textMuted: "muted",
  textSecondary: "secondary", surfaceInset: "inset", surfaceMuted: "muted", dangerText: "danger", success: "success"
} as never;
const styles = {} as never;

let tree: ReturnType<typeof create> | undefined;
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  announce.mockReset();
  alert.mockReset();
});

function render(props: Partial<Parameters<typeof ActivityEditorSheet>[0]> = {}) {
  const onSave = props.onSave ?? vi.fn(() => new Promise<string | null>(() => undefined));
  const onArchive = props.onArchive ?? vi.fn(async () => null);
  act(() => {
    tree = create(
      <ActivityEditorSheet
        activities={[{ id: "a", name: "Reading" }]}
        activity={null}
        defaultColor="lime"
        onArchive={onArchive}
        onClose={vi.fn()}
        onSave={onSave}
        pinnedCount={0}
        reduceMotion={false}
        styles={styles}
        theme={theme}
        {...props}
      />
    );
  });
  return { onArchive, onSave };
}
const byTestId = (id: string) => tree!.root.find((node: ReactTestInstance) => node.props.testID === id && typeof node.type === "string");
const pinSwitch = () => tree!.root.find((node: ReactTestInstance) => node.props.accessibilityLabel === "Pin to quick start" && (node.type as unknown) === "Switch");

describe("ActivityEditorSheet", () => {
  it("saves once however fast Create is tapped, pinned by default while quick start has room", () => {
    const { onSave } = render();
    act(() => byTestId("activity-editor-name").props.onChangeText("Piano"));
    act(() => {
      byTestId("activity-editor-save").props.onPress();
      byTestId("activity-editor-save").props.onPress();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ name: "Piano", color: "lime", icon: null, isPinned: true });
  });

  it("never pins a new activity when quick start is full", () => {
    const { onSave } = render({ pinnedCount: 6 });
    expect(pinSwitch().props.disabled).toBe(true);
    act(() => byTestId("activity-editor-name").props.onChangeText("Piano"));
    act(() => byTestId("activity-editor-save").props.onPress());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ isPinned: false }));
  });

  it("tells VoiceOver why it can't save", () => {
    const { onSave } = render();
    act(() => byTestId("activity-editor-name").props.onChangeText("reading"));
    act(() => byTestId("activity-editor-save").props.onPress());
    expect(onSave).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith("reading already exists.");
  });

  it("does not archive while a save is running, even from a confirmation already on screen", () => {
    const { onArchive, onSave } = render({ activity: { id: "a", name: "Reading", color: "lime" } });
    act(() => byTestId("activity-editor-archive").props.onPress());
    const confirm = (alert.mock.calls[0][2] as { text: string; onPress?: () => void }[]).find((button) => button.text === "Archive")!;
    act(() => byTestId("activity-editor-save").props.onPress());
    act(() => confirm.onPress!());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onArchive).not.toHaveBeenCalled();
  });
});
