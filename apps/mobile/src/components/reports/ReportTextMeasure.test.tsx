import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { View } from "react-native";
vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const settings = vi.hoisted(() => ({
  width: 375,
  fontScale: 1,
  bold: null as null | ((value: boolean) => void),
}));
vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  useWindowDimensions: () => settings,
  AccessibilityInfo: {
    addEventListener: (_name: string, callback: (value: boolean) => void) => {
      settings.bold = callback;
      return { remove: vi.fn() };
    },
  },
}));
import { useReportTextMeasure } from "./ReportTextMeasure";
import { useIntrinsicTextMeasure } from "../accessibility/IntrinsicTextMeasure";
function Probe({ sample }: { sample: string }) {
  const { widths, probe } = useReportTextMeasure(
    [sample],
    { fontSize: 14, fontVariant: ["tabular-nums"] },
    1.2,
  );
  return (
    <>
      <View
        testID="measurement-result"
        accessibilityValue={{ text: JSON.stringify(widths) }}
      />
      {probe}
    </>
  );
}
describe("native report measurements", () => {
  it("keeps the Reports adapter IDs and hidden native probe contract while sharing the neutral hook", () => {
    function AdapterProbe() {
      const report = useReportTextMeasure(["88:88"], { fontSize: 14 }, 1.2);
      const neutral = useIntrinsicTextMeasure(["88:88"], { fontSize: 14 }, 1.2);
      return <>{report.probe}{neutral.probe}</>;
    }
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<AdapterProbe />); });
    const textNodes = tree.root.findAllByType("Text" as never);
    expect(textNodes.map((node) => node.props.testID)).toEqual([
      "report-measure-88:88",
      "intrinsic-measure-88:88",
    ]);
    expect(textNodes.every((node) => node.props.maxFontSizeMultiplier === 1.2)).toBe(true);
    const probe = tree.root.findAllByType("View" as never).filter((node) => node.props.style?.width === 0);
    expect(probe).toHaveLength(2);
    expect(probe.every((node) => node.props.accessibilityElementsHidden && node.props.pointerEvents === "none")).toBe(true);
    act(() => tree.unmount());
  });

  it("grows and shrinks with current samples, rejects stale layout, and invalidates all font/width inputs", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Probe sample="88:88:88" />);
    });
    const width = () =>
      JSON.parse(
        tree.root.findByProps({ testID: "measurement-result" }).props
          .accessibilityValue.text,
      );
    const measure = () =>
      tree.root.findByType("Text" as never).props.onTextLayout;
    const event = (value: number) => ({
      nativeEvent: { lines: [{ width: value }] },
    });
    act(() => measure()(event(72.3)));
    expect(width()).toEqual({ "88:88:88": 75 });
    const stale = measure();
    act(() => tree.update(<Probe sample="888888:88:88" />));
    expect(width()).toEqual({});
    act(() => stale(event(999)));
    expect(width()).toEqual({});
    act(() => measure()(event(112)));
    expect(width()).toEqual({ "888888:88:88": 114 });
    act(() => tree.update(<Probe sample="88:88:88" />));
    act(() => measure()(event(72.3)));
    expect(width()).toEqual({ "88:88:88": 75 });
    for (const change of [
      () => {
        settings.fontScale = 3.2;
      },
      () => {
        settings.width = 320;
      },
      () => settings.bold?.(true),
    ]) {
      act(() => {
        change();
        tree.update(<Probe sample="88:88:88" />);
      });
      expect(width()).toEqual({});
      act(() => measure()(event(90)));
      expect(width()).toEqual({ "88:88:88": 92 });
    }
    const hidden = tree.root.findAllByType("View" as never)[1];
    expect(hidden.props.style).toMatchObject({
      width: 0,
      height: 0,
      overflow: "hidden",
    });
    expect(hidden.props.pointerEvents).toBe("none");
    expect(hidden.props.accessibilityElementsHidden).toBe(true);
    act(() => tree.unmount());
  });
});
