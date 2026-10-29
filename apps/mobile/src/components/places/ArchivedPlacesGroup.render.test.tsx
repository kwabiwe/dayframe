import { act, create, type ReactTestInstance } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("react-native", () => ({ StyleSheet: { hairlineWidth: 0.5 }, Text: "Text", View: "View" }));
vi.mock("react-native-reanimated", () => ({ default: { View: "ReanimatedView" } }));
vi.mock("@/components/icons/DayframeIcon", () => ({ DayframeIcon: "DayframeIcon" }));
vi.mock("./ReflowBlockGroup", async () => {
  const React = await import("react");
  return {
    ReflowBlockGroup: ({ children, foot, title }: { children: unknown; foot?: string; title: string }) =>
      React.createElement("Group", { foot, title }, children as never)
  };
});
vi.mock("@/components/settings/SettingsBlocks", async () => {
  const React = await import("react");
  return {
    SettingsPillButton: (props: { label: string; onPress: () => void; disabled?: boolean; accessibilityLabel?: string }) =>
      React.createElement("Pill", props)
  };
});
vi.mock("@/lib/motion", () => ({ localLayoutTransition: () => null, localPresenceEntering: () => null, localPresenceExiting: () => null }));
vi.mock("@/lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));

const { ArchivedPlacesGroup } = await import("./ArchivedPlacesGroup");
const theme = { dangerText: "red", textSecondary: "grey" } as never;
const styles = {} as never;
const gym = { id: "30000000-0000-4000-8000-000000000009", name: "Example Gym", archivedAt: "2026-10-20T09:00:00.000Z" };
const studio = { id: "30000000-0000-4000-8000-000000000008", name: "Example Studio", archivedAt: "2026-10-19T09:00:00.000Z" };

let tree: ReturnType<typeof create> | undefined;
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
});
const pills = () => tree!.root.findAll((node: ReactTestInstance) => (node.type as unknown) === "Pill");
const texts = () => tree!.root.findAll((node: ReactTestInstance) => (node.type as unknown) === "Text").map((node) => node.children.join(""));

function render(props: Partial<Parameters<typeof ArchivedPlacesGroup>[0]> = {}) {
  act(() => {
    tree = create(
      <ArchivedPlacesGroup
        onRestore={() => undefined}
        places={[gym, studio]}
        problem={null}
        reduceMotion={false}
        restoringId={null}
        styles={styles}
        theme={theme}
        {...props}
      />
    );
  });
}

describe("Places › Archived (location v3 PR 15b, PRD D19 A10)", () => {
  it("lists archived places with History kept and a named Restore pill", () => {
    const onRestore = vi.fn();
    render({ onRestore });
    const group = tree!.root.find((node: ReactTestInstance) => (node.type as unknown) === "Group");
    expect(group.props.title).toBe("Archived");
    expect(texts()).toEqual(["Example Gym", "History kept", "Example Studio", "History kept"]);
    expect(pills().map((pill) => pill.props.accessibilityLabel)).toEqual(["Restore Example Gym", "Restore Example Studio"]);
    act(() => pills()[1].props.onPress());
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: studio.id, name: "Example Studio" }));
  });

  it("is hidden when nothing is archived", () => {
    render({ places: [] });
    expect(tree!.toJSON()).toBeNull();
  });

  it("holds every Restore while one is saving, and says why a refused restore didn't happen", () => {
    render({ problem: "Couldn't restore Example Gym. Try again.", restoringId: gym.id });
    expect(pills().every((pill) => pill.props.disabled === true)).toBe(true);
    expect(texts()).toContain("Couldn't restore Example Gym. Try again.");
  });
});
