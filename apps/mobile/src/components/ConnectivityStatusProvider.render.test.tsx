import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  listeners: new Set<() => void>(),
  snapshot: { accountKey: "a", attentionIds: ["stop:old"], timeEntryNeedsAttentionCount: 0, timerStopNeedsAttentionCount: 1 } as Record<string, unknown>,
}));
vi.mock("react-native", () => ({
  AccessibilityInfo: { announceForAccessibility: mocks.announce },
  StyleSheet: { create: <T,>(styles: T) => styles },
  View: "View",
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
  FadeIn: { duration: () => ({}) },
  FadeOut: { duration: () => ({}) },
}));
vi.mock("expo-symbols", () => ({ SymbolView: "SymbolView" }));
vi.mock("@/lib/connectivity", () => ({ useConnectivity: () => ({ status: "online" }) }));
vi.mock("@/lib/connectivityPresentation", async () => import("../lib/connectivityPresentation"));
vi.mock("@/lib/durableWorkMonitor", () => ({
  getDurableWorkSnapshot: () => mocks.snapshot,
  subscribeDurableWork: (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  },
}));
vi.mock("@/lib/motion", () => ({ MOBILE_MOTION: { control: 140 }, useReduceMotionPreference: () => false }));
vi.mock("@/lib/mobileTheme", () => ({ useMobileTheme: () => ({ theme: { textSecondary: "#8993A7" } }) }));

import { ConnectivityStatusProvider, useSyncAttentionCount } from "./ConnectivityStatusStrip";

function publish(next: Record<string, unknown>) {
  mocks.snapshot = next;
  for (const listener of mocks.listeners) listener();
}

function Probe({ onCount }: { onCount: (count: number) => void }) {
  onCount(useSyncAttentionCount());
  return null;
}

describe("ConnectivityStatusProvider attention announcements", () => {
  it("announces each new rejection, even when another clears in the same update, but not at launch", () => {
    const counts: number[] = [];
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <ConnectivityStatusProvider>
          <Probe onCount={(count) => counts.push(count)} />
        </ConnectivityStatusProvider>,
      );
    });
    // An older rejection already present at launch is not re-announced.
    expect(mocks.announce).not.toHaveBeenCalled();
    expect(counts.at(-1)).toBe(1);
    // The old one is discarded while a new one is rejected: the count stays 1.
    act(() => publish({ accountKey: "a", attentionIds: ["entry:new"], timeEntryNeedsAttentionCount: 1, timerStopNeedsAttentionCount: 0 }));
    expect(mocks.announce).toHaveBeenCalledTimes(1);
    expect(mocks.announce).toHaveBeenCalledWith("A change couldn't be saved. Open Sync help from the account button.");
    // Resolving it announces nothing; another account's rejections are a fresh baseline.
    act(() => publish({ accountKey: "a", attentionIds: [], timeEntryNeedsAttentionCount: 0, timerStopNeedsAttentionCount: 0 }));
    act(() => publish({ accountKey: "b", attentionIds: ["stop:b1"], timeEntryNeedsAttentionCount: 0, timerStopNeedsAttentionCount: 1 }));
    expect(mocks.announce).toHaveBeenCalledTimes(1);
    expect(counts.at(-1)).toBe(1);
    act(() => tree.unmount());
  });
});
