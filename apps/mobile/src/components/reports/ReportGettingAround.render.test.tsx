import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
}));
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" } }));
vi.mock("../../lib/motion", () => ({ localPresenceEntering: () => undefined }));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));
vi.mock("../icons/DayframeIcon", () => ({ DayframeIcon: (props: { glyph: string }) => `icon:${props.glyph}` }));

import { ReportGettingAround, ReportNotLogged } from "./ReportGettingAround";

const theme = { surface: "#111", surfaceMuted: "#222", border: "#333", textPrimary: "#FFF", textSecondary: "#AAA", textMuted: "#777" } as never;
const labels = (tree: ReturnType<typeof create>) => tree.root.findAll((node) => typeof node.props.accessibilityLabel === "string")
  .map((node) => node.props.accessibilityLabel as string);

describe("iPhone Reports › Getting around and Not logged (location v4 step 18)", () => {
  it("lists the time by leg mode, most first, with stops and changes, each trip counted once", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<ReportGettingAround reduceMotion={false} theme={theme} summary={{
        tripCount: 2, totalSeconds: 4_800, stopsSeconds: 300,
        byMode: [{ mode: "train", seconds: 1_800 }, { mode: "walking", seconds: 1_500 }, { mode: "unknown", seconds: 1_200 }]
      }} />);
    });
    const spoken = labels(tree);
    expect(spoken[0]).toMatch(/getting around, 2 trips, each counted once\.$/);
    expect(spoken.slice(1).map((label) => label.split(",")[0])).toEqual(["Train", "Walk", "Mode not known", "Stops and changes"]);
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain("icon:train-front");
    expect(json).not.toMatch(/\bkm\b|miles|metres/);
  });

  it("says Not logged, outside the total and goals, and hides under a minute", () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<ReportNotLogged seconds={3_720} theme={theme} />); });
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain("Not counted above or in goals.");
    // No "Check them" until the iPhone's Calendar shows those places (Codex r1 on #569).
    expect(tree.root.findAll((node) => node.props.accessibilityRole === "button")).toHaveLength(0);
    act(() => { tree = create(<ReportNotLogged seconds={30} theme={theme} />); });
    expect(tree.toJSON()).toBeNull();
  });
});
