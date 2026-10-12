import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const timing = vi.hoisted(() => vi.fn(() => ({ start() {}, stop() {} })));
const animatedValues = vi.hoisted(() => [] as Array<{ value: number }>);
vi.mock("react-native", () => ({
  Animated: { Value: class { constructor(public value: number) { animatedValues.push(this); } setValue(next: number) { this.value = next; } interpolate() { return 0; } }, View: "AnimatedView", timing },
  Easing: { cubic: () => 0, out: (easing: unknown) => easing },
  Pressable: "Pressable", Text: "Text", View: "View",
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 }
}));
vi.mock("react-native-svg", () => ({ default: "Svg", Circle: "Circle", Ellipse: "Ellipse", G: "G", Line: "Line", Path: "Path", Polygon: "Polygon", Polyline: "Polyline", Rect: "Rect" }));
const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock("../../lib/motion", () => ({ useReduceMotionPreference: () => motion.reduce }));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));

const { SettingsSwitch } = await import("./SettingsBlocks");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = { borderStrong: "#3B465B", success: "#22C55E" } as never;

function render(value: boolean, onValueChange = vi.fn(), disabled = false) {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<SettingsSwitch disabled={disabled} label="Haptics" onValueChange={onValueChange} theme={theme} value={value} />); });
  return { onValueChange, tree, track: () => tree.root.findByProps({ accessibilityRole: "switch" }) };
}

describe("the drawn Settings switch (owner, 12 Oct: centred in its row on every iOS)", () => {
  it("is a VoiceOver switch with its state, and a tap asks for the other value", () => {
    const { onValueChange, track } = render(false);
    expect(track().props.accessibilityLabel).toBe("Haptics");
    expect(track().props.accessibilityState).toEqual({ checked: false, disabled: false });
    act(() => track().props.onPress());
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it("is green when on and the strong border grey when off, 51 × 31 points", () => {
    const on = render(true).track();
    const off = render(false).track();
    const flat = (style: unknown[]) => Object.assign({}, ...style.flat().filter(Boolean)) as Record<string, unknown>;
    expect(flat(on.props.style)).toMatchObject({ backgroundColor: "#22C55E", height: 31, width: 51 });
    expect(flat(off.props.style).backgroundColor).toBe("#3B465B");
  });

  it("slides the thumb in normal motion and jumps under Reduce Motion", () => {
    motion.reduce = false;
    timing.mockClear();
    const { tree } = render(false);
    act(() => tree.update(<SettingsSwitch label="Haptics" onValueChange={vi.fn()} theme={theme} value />));
    expect(timing).toHaveBeenCalledTimes(1);
    motion.reduce = true;
    timing.mockClear();
    const reduced = render(false);
    act(() => reduced.tree.update(<SettingsSwitch label="Haptics" onValueChange={vi.fn()} theme={theme} value />));
    expect(timing).not.toHaveBeenCalled();
  });

  it("settles the thumb at its end when Reduce Motion turns on mid-slide (Codex r1)", () => {
    motion.reduce = false;
    timing.mockClear();
    animatedValues.length = 0;
    const { tree } = render(false);
    const position = animatedValues[0];
    act(() => tree.update(<SettingsSwitch label="Haptics" onValueChange={vi.fn()} theme={theme} value />));
    expect(timing).toHaveBeenCalledTimes(1);
    // The mocked slide never moves the value: the thumb is "half-way" when the preference flips.
    expect(position.value).toBe(0);
    motion.reduce = true;
    act(() => tree.update(<SettingsSwitch label="Haptics" onValueChange={vi.fn()} theme={theme} value />));
    expect(position.value).toBe(1);
    motion.reduce = false;
  });

  it("can't be changed while disabled", () => {
    const { track } = render(true, vi.fn(), true);
    expect(track().props.disabled).toBe(true);
    expect(track().props.accessibilityState).toEqual({ checked: true, disabled: true });
  });
});
