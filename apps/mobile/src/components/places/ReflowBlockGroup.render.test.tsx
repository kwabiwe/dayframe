import { act, create, type ReactTestInstance } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("react-native", () => ({ Text: "Text" }));
vi.mock("react-native-reanimated", () => ({ default: { Text: "ReanimatedText", View: "ReanimatedView" } }));
vi.mock("@/components/settings/SettingsBlocks", () => ({
  settingsBlockGroupStyles: () => ({ eyebrow: { e: 1 }, foot: { f: 1 }, group: { g: 1 }, list: { l: 1 } })
}));
// The shared layout owner, marked by its Reduce Motion argument.
vi.mock("@/lib/motion", () => ({ localLayoutTransition: (reduceMotion: boolean) => ({ layout: reduceMotion ? "reduced" : "moving" }) }));
vi.mock("@/lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));

const { ReflowBlockGroup } = await import("./ReflowBlockGroup");
const theme = { surface: "#000", textMuted: "#777", textSecondary: "#aaa" } as never;

let tree: ReturnType<typeof create> | undefined;
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
});
const animated = () => tree!.root.findAll((node: ReactTestInstance) => typeof node.type === "string" && node.type.startsWith("Reanimated"));

describe("ReflowBlockGroup (Codex r1 on #508)", () => {
  it("gives the group, its list and its footnote the shared layout transition", () => {
    act(() => { tree = create(<ReflowBlockGroup foot="Footnote" reduceMotion={false} theme={theme} title="Saved places">{"row"}</ReflowBlockGroup>); });
    const nodes = animated();
    expect(nodes.map((node) => node.type)).toEqual(["ReanimatedView", "ReanimatedView", "ReanimatedText"]);
    expect(nodes.every((node) => (node.props.layout as { layout: string }).layout === "moving")).toBe(true);
    expect(tree!.root.findByType("Text" as never).children).toEqual(["SAVED PLACES"]);
  });

  it("keeps the Reduce Motion path and draws no footnote without one", () => {
    act(() => { tree = create(<ReflowBlockGroup reduceMotion theme={theme} title="Archived">{"row"}</ReflowBlockGroup>); });
    const nodes = animated();
    expect(nodes.map((node) => node.type)).toEqual(["ReanimatedView", "ReanimatedView"]);
    expect(nodes.every((node) => (node.props.layout as { layout: string }).layout === "reduced")).toBe(true);
  });
});
