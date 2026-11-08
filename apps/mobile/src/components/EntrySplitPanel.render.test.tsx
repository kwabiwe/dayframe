import { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { DAYFRAME_THEME } from "@dayframe/shared";
import type { MobileTheme } from "@/lib/mobileTheme";
import { EntrySplitPanel } from "./EntrySplitPanel";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  Pressable: "Pressable", View: "View", ScrollView: "ScrollView", Text: "Text",
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 }
}));
vi.mock("react-native-reanimated", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  const { useRef } = await import("../../../../node_modules/react/index.js");
  return { default: { View: "AnimatedView" }, runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: (get: () => unknown) => get(), useSharedValue: (value: number | boolean) => useRef({ value }).current };
});
const native = vi.hoisted(() => ({ start: vi.fn(), update: vi.fn(), finalize: vi.fn(), tick: vi.fn() }));
vi.mock("react-native-gesture-handler", () => ({ GestureDetector: ({ children }: { children: unknown }) => children, Gesture: {
  Pan: () => {
    const gesture = {
      enabled: () => gesture, activeOffsetX: () => gesture, failOffsetY: () => gesture,
      onStart: (fn: typeof native.start) => { native.start = fn; return gesture; },
      onUpdate: (fn: typeof native.update) => { native.update = fn; return gesture; },
      onFinalize: (fn: typeof native.finalize) => { native.finalize = fn; return gesture; }
    };
    return gesture;
  }
} }));
vi.mock("@/components/icons/DayframeIcon", () => ({ DayframeIcon: () => null }));
vi.mock("@/components/TimeWheelPanel", () => ({ TimeWheelPanel: () => "Native minute wheel" }));
vi.mock("@/lib/haptics", () => ({ playHaptic: native.tick }));
vi.mock("@/lib/motion", () => ({ localPresenceEntering: () => undefined }));
vi.mock("@/lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));
vi.mock("@/lib/mobileTheme", () => ({ pressable: (style: unknown) => () => style }));

const startMs = new Date(2026, 10, 8, 11, 6).getTime();
const minute = 60_000;
const stopMs = startMs + 50 * minute;
const bounds = { startMs, stopMs, minMs: startMs + minute, maxMs: stopMs - minute };
const theme: MobileTheme = { ...DAYFRAME_THEME.light, mode: "light", pressed: DAYFRAME_THEME.light.accentPressed };

describe("compact block Split panel", () => {
  it("drags whole minutes into both previews, restores a cancelled drag and keeps the existing wheel optional", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const confirm = vi.fn();
    const back = vi.fn();
    let root!: ReactTestRenderer;
    function Preview() {
      const [value, setValue] = useState(startMs + 25 * minute);
      const [wheel, setWheel] = useState(false);
      return <EntrySplitPanel bounds={bounds} busy={false} clockFormat="24h" error={null} onBack={back}
        onConfirm={() => confirm(value)} onDividerChange={setValue} onToggleWheel={() => setWheel((open) => !open)}
        onWheelChange={() => undefined} reduceMotion revision={0} theme={theme} timeControlRef={null}
        valueMs={value} wheelId={wheel ? 2 : null} wheelHeight={180} />;
    }
    await act(async () => { root = create(<Preview />); });
    const get = (testID: string) => root.root.find((node) => typeof node.type === "string" && node.props.testID === testID);
    const text = () => JSON.stringify(root.toJSON());
    expect(text()).toContain("11:06–11:31");
    expect(text()).toContain("11:31–11:56");
    expect(text()).not.toContain("Native minute wheel");
    await act(async () => {
      get("time-entry-split-divider").props.onLayout({ nativeEvent: { layout: { width: 300 } } });
      native.start();
      native.update({ translationX: 30 });
    });
    expect(text()).toContain("11:06–11:36");
    expect(text()).toContain("11:36–11:56");
    expect(native.tick).toHaveBeenCalledWith("tick");
    await act(async () => { native.finalize({}, false); });
    expect(text()).toContain("11:06–11:31");
    await act(async () => { get("time-entry-split-value").props.onPress(); });
    expect(text()).toContain("Native minute wheel");
    expect(text()).toContain("11:31–11:56");
    await act(async () => { get("time-entry-split-confirm").props.onPress(); });
    expect(confirm).toHaveBeenCalledWith(startMs + 25 * minute);
    expect(get("time-entry-split-confirm").props.style({ pressed: false })).toContainEqual({ backgroundColor: theme.accent });
    expect(text()).toContain(theme.onAccent);
    await act(async () => { get("time-entry-split-keep").props.onPress(); });
    expect(back).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
});
