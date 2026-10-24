import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  Animated: { Value: class { setValue() {} interpolate() { return 0; } }, View: "AnimatedView", timing: () => ({ start() {}, stop() {} }) },
  Easing: { cubic: () => 0, out: (easing: unknown) => easing },
  Pressable: "Pressable", Text: "Text", View: "View",
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 }
}));
vi.mock("react-native-svg", () => ({ default: "Svg", Circle: "Circle", Ellipse: "Ellipse", G: "G", Line: "Line", Path: "Path", Polygon: "Polygon", Polyline: "Polyline", Rect: "Rect" }));
vi.mock("../../lib/motion", () => ({ useReduceMotionPreference: () => false }));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));

const { SettingsBlockRow } = await import("./SettingsBlocks");
const { placesWatchedSummary } = await import("../../lib/settingsSyncDiagnostics");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = { border: "#333", textMuted: "#999", textPrimary: "#fff", dangerText: "#f00", surfaceMuted: "#111" } as never;

function texts(tree: ReactTestRenderer) {
  return tree.root.findAll((node) => (node.type as unknown) === "Text").map((node) => node.children.join(""));
}

describe("a read-only Settings row with a value (staging QA 6.1)", () => {
  it("shows Sync help's Places watched value next to its explanation", () => {
    const summary = placesWatchedSummary({
      geofencingActive: true, activeMonitorCount: 20, configuredMonitorCount: 26, geofenceSelection: "nearest"
    })!;
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <SettingsBlockRow divider={false} subtitle={summary.detail} testID="sync-help-places-watched" theme={theme}
          title="Places watched" value={summary.value} />
      );
    });
    expect(texts(tree)).toEqual(["Places watched", summary.detail, "20 of 26"]);
    const row = tree.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "sync-help-places-watched");
    expect(row.props.accessible).toBe(true);
    expect(row.props.accessibilityLabel).toBe(`Places watched, 20 of 26, ${summary.detail}`);
  });

  it("leaves a row with its own control as it was", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<SettingsBlockRow control={<></>} theme={theme} title="Haptics" value="ignored" />);
    });
    expect(texts(tree)).toEqual(["Haptics"]);
  });
});
