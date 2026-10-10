import { describe, expect, it } from "vitest";
import {
  connectivityStatusColorRole,
  createConnectivityPresentationState,
  createDistinctConnectivityAnnouncementTracker,
  syncAttentionPresentation,
  updateConnectivityPresentation,
  type ConnectivityPresentationState
} from "./connectivityPresentation";
import { CONNECTIVITY_SUCCESS_NOTICE_MS, type ConnectivityStatus } from "./connectivityState";

function step(
  state: ConnectivityPresentationState,
  status: ConnectivityStatus,
  now: number,
  accountKey: string | null = "account-a"
) {
  return updateConnectivityPresentation({ accountKey, now, state, status });
}

describe("Blocks connectivity presentation (offline and back online only)", () => {
  it("stays visually empty online and at launch, whatever is waiting to sync", () => {
    let state = createConnectivityPresentationState();
    let result = step(state, "unknown", 0);
    expect(result.viewModel).toBeNull();
    state = result.state;
    result = step(state, "online", 10);
    // Unknown → online at launch is not a return from offline.
    expect(result.viewModel).toBeNull();
  });

  it("shows offline while confirmed offline, then back online for about two seconds", () => {
    let state = step(createConnectivityPresentationState(), "online", 0).state;
    let result = step(state, "offline", 100);
    expect(result.viewModel).toMatchObject({ id: "offline", variant: "offline" });
    expect(result.viewModel?.accessibilityLabel).toContain("Offline");
    state = result.state;
    result = step(state, "online", 5_000);
    expect(result.viewModel).toMatchObject({ id: "online-1", variant: "online", accessibilityLabel: "Back online." });
    state = result.state;
    result = step(state, "online", 5_000 + CONNECTIVITY_SUCCESS_NOTICE_MS - 1);
    expect(result.viewModel?.variant).toBe("online");
    state = result.state;
    result = step(state, "online", 5_000 + CONNECTIVITY_SUCCESS_NOTICE_MS);
    expect(result.viewModel).toBeNull();
    expect(result.state.backOnlineUntil).toBeNull();
  });

  it("keeps the offline memory through an unknown spell, and a new outage supersedes the notice", () => {
    let state = step(createConnectivityPresentationState(), "offline", 0).state;
    state = step(state, "unknown", 50).state;
    let result = step(state, "online", 60);
    expect(result.viewModel?.variant).toBe("online");
    state = result.state;
    result = step(state, "offline", 70);
    expect(result.viewModel?.variant).toBe("offline");
    expect(result.state.backOnlineUntil).toBeNull();
    state = result.state;
    result = step(state, "online", 80);
    expect(result.viewModel).toMatchObject({ id: "online-2" });
  });

  it("never carries a notice into another account", () => {
    let state = step(createConnectivityPresentationState(), "offline", 0, "account-a").state;
    const result = step(state, "online", 10, "account-b");
    expect(result.viewModel).toBeNull();
    state = result.state;
    expect(step(state, "online", 20, "account-b").viewModel).toBeNull();
  });

  it("uses the neutral secondary colour for every state", () => {
    expect(connectivityStatusColorRole("offline")).toBe("textSecondary");
    expect(connectivityStatusColorRole("online")).toBe("textSecondary");
  });

  it("announces each distinct state once", () => {
    const tracker = createDistinctConnectivityAnnouncementTracker();
    const offline = { accessibilityLabel: "Offline.", id: "offline", variant: "offline" as const };
    expect(tracker.next(offline)).toBe("Offline.");
    expect(tracker.next(offline)).toBeNull();
    expect(tracker.next(null)).toBeNull();
    expect(tracker.next(offline)).toBe("Offline.");
  });
});

describe("Sync attention on the avatar", () => {
  it("is nothing without rejected changes and names the count otherwise", () => {
    expect(syncAttentionPresentation(0)).toBeNull();
    expect(syncAttentionPresentation(1)).toEqual({
      accessibilityHint: "Opens Sync help in Settings",
      accessibilityLabel: "Account and settings. A change couldn't be saved and needs your attention.",
      count: 1
    });
    expect(syncAttentionPresentation(3)?.accessibilityLabel).toBe(
      "Account and settings. 3 changes couldn't be saved and need your attention."
    );
  });
});
