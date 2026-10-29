import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    account: { owner: { userId: "user-a", workspaceId: "ws" } as { userId: string; workspaceId: string } | null, epoch: 1, listeners },
    timelines: [] as Array<{ resolve: (value: unknown) => void }>,
    evidence: vi.fn(async (..._args: unknown[]) => ({ evidenceExpired: false, segment: { evidenceCount: 3 }, map: { gaps: [] }, stops: [] }))
  };
});
vi.mock("react-native", () => ({ ScrollView: "ScrollView" }));
vi.mock("expo-router", () => ({ router: { back: vi.fn() } }));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));
vi.mock("@/components/BlocksNavHeader", () => ({ BlocksNavHeader: "BlocksNavHeader", usePreviousScreenLabel: () => "Settings" }));
vi.mock("@/components/settings/SettingsBlocks", () => ({ SettingsBlockGroup: "SettingsBlockGroup", SettingsBlockRow: "SettingsBlockRow" }));
vi.mock("@/lib/clockFormat", () => ({ useClockFormat: () => "24h" }));
vi.mock("@/lib/mobileTheme", () => ({ useMobileTheme: () => ({ styles: {}, theme: {} }) }));
vi.mock("@/lib/api", () => ({
  fetchLocationTimeline: () => new Promise((resolve) => { mocks.timelines.push({ resolve }); }),
  fetchTimelineItemEvidence: mocks.evidence
}));
vi.mock("@/lib/mobileAccount", () => ({
  currentMobileAccountEpoch: () => mocks.account.epoch,
  mobileAccountKey: (owner: { userId: string; workspaceId: string }) => `${owner.workspaceId}:${owner.userId}`,
  readActiveMobileAccount: async () => mocks.account.owner,
  subscribeActiveMobileAccount: (listener: () => void) => {
    mocks.account.listeners.add(listener);
    return () => mocks.account.listeners.delete(listener);
  }
}));

const { default: LocationDetailsRoute } = await import("../../../app/location-details");

// Synthetic ids and names only.
const day = (name: string, id: string) => ({ items: [{ kind: "place", id, name, startedAt: "2026-10-29T09:00:00.000Z", stoppedAt: "2026-10-29T10:00:00.000Z" }] });
const settle = () => act(async () => { for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)); });
const titles = (tree: ReturnType<typeof create>) => tree.root.findAll((node) => (node.type as unknown) === "SettingsBlockRow").map((node) => node.props.title);

describe("Location details belong to the account they were read for (Codex r2 on #620)", () => {
  it("drops account A's late answer after a switch to B, shows only B's places, and reads B's item as B", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<LocationDetailsRoute />); });
    await settle();
    expect(mocks.timelines).toHaveLength(1);
    // A → B while A's day is still being read.
    mocks.account.owner = { userId: "user-b", workspaceId: "ws" };
    mocks.account.epoch += 1;
    await act(async () => { for (const listener of mocks.account.listeners) listener(); });
    await settle();
    expect(mocks.timelines).toHaveLength(2);
    // A's answer arrives late: never shown.
    await act(async () => { mocks.timelines[0].resolve(day("A's private café", "seg-a")); });
    await settle();
    expect(titles(tree)).toEqual(["Loading today's places…"]);
    await act(async () => { mocks.timelines[1].resolve(day("B's library", "seg-b")); });
    await settle();
    expect(titles(tree)).toEqual(["B's library"]);
    // Tapping it reads it as B.
    await act(async () => { tree.root.findByProps({ testID: "location-details-seg-b" }).props.onPress(); });
    await settle();
    expect(mocks.evidence).toHaveBeenCalledWith({ id: "seg-b", kind: "place", startedAt: "2026-10-29T09:00:00.000Z" },
      { owner: { userId: "user-b", workspaceId: "ws" } });
    expect(tree.root.findByProps({ testID: "location-details-seg-b" }).props.subtitle).toBe("3 readings");
  });
});
