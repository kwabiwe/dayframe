import { act, create, type ReactTestInstance } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const mocks = vi.hoisted(() => ({ announce: vi.fn(), list: vi.fn(), resume: vi.fn(), epoch: 1, listeners: new Set<() => void>() }));
vi.mock("react-native", () => ({
  AccessibilityInfo: { announceForAccessibility: (message: string) => mocks.announce(message) },
  Text: "Text",
  View: "View"
}));
vi.mock("react-native-reanimated", () => ({ default: { View: "ReanimatedView" } }));
vi.mock("expo-router", async () => {
  const React = await import("react");
  return { useFocusEffect: (effect: () => void | (() => void)) => React.useEffect(effect, [effect]) };
});
vi.mock("@/components/icons/DayframeIcon", () => ({ DayframeIcon: "DayframeIcon" }));
vi.mock("@/components/settings/SettingsBlocks", async () => {
  const React = await import("react");
  return {
    SettingsBlockGroup: ({ children, title }: { children: unknown; title: string }) => React.createElement("Group", { title }, children as never),
    SettingsPillButton: (props: { label: string; onPress: () => void; disabled?: boolean; accessibilityLabel?: string }) =>
      React.createElement("Pill", props)
  };
});
vi.mock("@/lib/api", () => ({ listStoppedTrips: () => mocks.list(), resumeLoggingTrips: (key: string) => mocks.resume(key) }));
vi.mock("@/lib/mobile-network", () => ({ isRetryableMobileConnectivityFailure: (error: unknown) => error instanceof TypeError }));
vi.mock("@/lib/motion", () => ({ localLayoutTransition: () => null, localPresenceEntering: () => null, localPresenceExiting: () => null }));
vi.mock("@/lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));
vi.mock("@/lib/mobileAccount", () => ({
  currentMobileAccountEpoch: () => mocks.epoch,
  subscribeActiveMobileAccount: (listener: () => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener); }
}));
const switchAccount = () => { mocks.epoch += 1; for (const listener of mocks.listeners) listener(); };

const { StoppedTripsGroup } = await import("./StoppedTripsGroup");
const theme = { dangerText: "red", textSecondary: "grey" } as never;
const styles = {} as never;
const trip = { patternKey: "key-1", label: "Synthetic A → Synthetic B", stoppedAt: "2026-10-17T07:00:00.000Z" };

let tree: ReturnType<typeof create> | undefined;
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  mocks.announce.mockReset();
  mocks.list.mockReset();
  mocks.resume.mockReset();
});
const pills = () => tree!.root.findAll((node: ReactTestInstance) => (node.type as unknown) === "Pill");
const texts = () => tree!.root.findAll((node: ReactTestInstance) => (node.type as unknown) === "Text").map((node) => node.children.join(""));

describe("Places › Trips you log yourself (PRD D19, A4)", () => {
  it("lists stopped trips and logs one automatically again, removing it", async () => {
    mocks.list.mockResolvedValue([trip]);
    mocks.resume.mockResolvedValue(undefined);
    await act(async () => { tree = create(<StoppedTripsGroup reduceMotion={false} styles={styles} theme={theme} />); });
    expect(texts()).toContain(trip.label);
    await act(async () => { pills()[0].props.onPress(); });
    expect(mocks.resume).toHaveBeenCalledWith("key-1");
    expect(tree!.toJSON()).toBeNull();
    expect(mocks.announce).toHaveBeenCalledWith(expect.stringContaining("logs itself again"));
  });

  it("puts the trip back with an announced line when the server refuses", async () => {
    mocks.list.mockResolvedValue([trip]);
    mocks.resume.mockRejectedValue(new TypeError("Network request failed"));
    await act(async () => { tree = create(<StoppedTripsGroup reduceMotion={false} styles={styles} theme={theme} />); });
    await act(async () => { pills()[0].props.onPress(); });
    expect(texts()).toContain(trip.label);
    expect(texts().some((text) => text.includes("Try again when you're online"))).toBe(true);
    expect(mocks.announce).toHaveBeenCalled();
  });

  it("shows nothing without stopped trips or when the list cannot load", async () => {
    mocks.list.mockRejectedValue(new Error("offline"));
    await act(async () => { tree = create(<StoppedTripsGroup reduceMotion={false} styles={styles} theme={theme} />); });
    expect(tree!.toJSON()).toBeNull();
  });

  it("clears the list for another account and drops a read or answer from before (Codex r1 on #464)", async () => {
    let answer!: (trips: unknown[]) => void;
    mocks.list.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    await act(async () => { tree = create(<StoppedTripsGroup reduceMotion={false} styles={styles} theme={theme} />); });
    await act(async () => { switchAccount(); });
    await act(async () => { answer([trip]); });
    expect(tree!.toJSON()).toBeNull();
  });

  it("never brings back a trip logged again when an earlier read lands afterwards (Codex r1 on #464)", async () => {
    mocks.list.mockResolvedValueOnce([trip]);
    await act(async () => { tree = create(<StoppedTripsGroup reduceMotion={false} styles={styles} theme={theme} />); });
    let stale!: (trips: unknown[]) => void;
    mocks.list.mockReturnValueOnce(new Promise((resolve) => { stale = resolve; }));
    mocks.resume.mockResolvedValue(undefined);
    // A focus read starts, then Log again succeeds, then that read lands with the trip still in it.
    await act(async () => { tree!.update(<StoppedTripsGroup reduceMotion={false} styles={styles} theme={theme} />); });
    await act(async () => { pills()[0].props.onPress(); });
    await act(async () => { stale([trip]); });
    expect(texts()).not.toContain(trip.label);
  });
});
