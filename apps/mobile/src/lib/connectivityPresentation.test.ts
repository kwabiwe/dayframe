import { describe, expect, it } from "vitest";
import { DAYFRAME_THEME } from "@dayframe/shared";
import {
  connectivityStatusColorRole,
  connectivityStatusViewModel,
  createConnectivityPresentationState,
  createDistinctConnectivityAnnouncementTracker,
  updateConnectivityPresentation
} from "./connectivityPresentation";

const NOW = Date.parse("2026-08-22T12:00:00.000Z");

describe("connectivity status presentation", () => {
  it("renders no status for settled online startup with no work", () => {
    expect(view("online", 0)).toBeNull();
  });

  it("renders a neutral Offline icon from confirmed offline truth", () => {
    expect(view("offline", 0)).toMatchObject({
      isActionable: false,
      variant: "offline"
    });
    expect(connectivityStatusColorRole("offline")).toBe("textSecondary");
  });

  it("uses a contrast-safe neutral foreground in Light and Dark appearance", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const variant of ["offline", "pending", "syncing", "synced", "attention"] as const) {
        const role = connectivityStatusColorRole(variant);
        expect(contrastRatio(
          DAYFRAME_THEME[mode].background,
          DAYFRAME_THEME[mode][role]
        )).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps ordinary background retries out of the header", () => {
    expect(view("online", 3)).toBeNull();
  });

  it("renders Syncing only while a durable recovery request is active", () => {
    expect(view("online", 3, 0, true)).toMatchObject({
      isActionable: false,
      variant: "syncing"
    });
  });

  it("shows Synced only for a non-zero to zero transition and expires after two seconds", () => {
    const initial = updateConnectivityPresentation({
      accountKey: "workspace:user",
      attentionCount: 0,
      now: NOW,
      pendingCount: 2,
      state: createConnectivityPresentationState(),
      status: "online"
    });
    const completed = updateConnectivityPresentation({
      accountKey: "workspace:user",
      attentionCount: 0,
      now: NOW + 10,
      pendingCount: 0,
      state: initial.state,
      status: "online"
    });
    expect(completed.viewModel).toMatchObject({ variant: "synced" });

    const expired = updateConnectivityPresentation({
      accountKey: "workspace:user",
      attentionCount: 0,
      now: NOW + 2_011,
      pendingCount: 0,
      state: completed.state,
      status: "online"
    });
    expect(expired.viewModel).toBeNull();
  });

  it("shows actionable permanent timer or time-entry attention without consuming a false Synced notice", () => {
    const pending = updateConnectivityPresentation({
      accountKey: "workspace:user",
      attentionCount: 0,
      now: NOW,
      pendingCount: 1,
      state: createConnectivityPresentationState(),
      status: "online"
    });
    const rejected = updateConnectivityPresentation({
      accountKey: "workspace:user",
      attentionCount: 1,
      now: NOW + 1,
      pendingCount: 0,
      state: pending.state,
      status: "online"
    });
    expect(rejected.viewModel).toMatchObject({
      isActionable: true,
      variant: "attention"
    });
    expect(rejected.state.onlineUntil).toBeNull();

    const cleared = updateConnectivityPresentation({
      accountKey: "workspace:user",
      attentionCount: 0,
      now: NOW + 2,
      pendingCount: 0,
      state: rejected.state,
      status: "online"
    });
    expect(cleared.viewModel).toBeNull();
  });

  it("keeps confirmed offline ahead of permanent attention in the one status slot", () => {
    expect(view("offline", 0, 1)).toMatchObject({
      accessibilityLabel:
        "Offline. A timer or time entry sync issue also needs attention. Open Sync and diagnostics.",
      isActionable: true,
      variant: "offline"
    });
  });

  it("self-heals after an out-of-band drain without a recovery-pass verdict", () => {
    const syncing = updateConnectivityPresentation({
      accountKey: "workspace:user",
      attentionCount: 0,
      isTransmitting: true,
      now: NOW,
      pendingCount: 1,
      state: createConnectivityPresentationState(),
      status: "online"
    });
    const drained = updateConnectivityPresentation({
      accountKey: "workspace:user",
      attentionCount: 0,
      now: NOW + 1,
      pendingCount: 0,
      state: syncing.state,
      status: "online"
    });
    expect(syncing.viewModel?.variant).toBe("syncing");
    expect(drained.viewModel?.variant).toBe("synced");
  });

  it("does not consume a Synced transition when a calculated render is discarded", () => {
    const pending = updateConnectivityPresentation({
      accountKey: "workspace:user",
      attentionCount: 0,
      now: NOW,
      pendingCount: 1,
      state: createConnectivityPresentationState(),
      status: "online"
    });
    const discarded = updateConnectivityPresentation({
      accountKey: "workspace:user",
      attentionCount: 0,
      now: NOW + 1,
      pendingCount: 0,
      state: pending.state,
      status: "online"
    });
    const committed = updateConnectivityPresentation({
      accountKey: "workspace:user",
      attentionCount: 0,
      now: NOW + 1,
      pendingCount: 0,
      state: pending.state,
      status: "online"
    });

    expect(discarded.viewModel?.id).toBe("synced-1");
    expect(committed.viewModel?.id).toBe("synced-1");
    expect(pending.state).toMatchObject({
      completionSequence: 0,
      onlineUntil: null,
      previousPendingCount: 1
    });
    expect(updateConnectivityPresentation({
      accountKey: "workspace:user",
      attentionCount: 0,
      now: NOW,
      pendingCount: 1,
      state: pending.state,
      status: "online"
    }).state).toBe(pending.state);
  });

  it("announces each distinct visible transition once", () => {
    const tracker = createDistinctConnectivityAnnouncementTracker();
    const offline = view("offline", 0);
    const syncing = view("online", 1, 0, true);
    const attention = view("online", 0, 1);
    expect(tracker.next(offline)).toBe("Offline. Changes will sync later.");
    expect(tracker.next(offline)).toBeNull();
    expect(tracker.next(syncing)).toBe("Syncing saved changes.");
    expect(tracker.next(syncing)).toBeNull();
    expect(tracker.next(attention)).toBe(
      "A timer or time entry sync issue needs attention. Open Sync and diagnostics."
    );
    expect(tracker.next(view("offline", 0, 1))).toBe(
      "Offline. A timer or time entry sync issue also needs attention. Open Sync and diagnostics."
    );
    expect(tracker.next(null)).toBeNull();
    expect(tracker.next(offline)).toBe("Offline. Changes will sync later.");
  });
});

function view(
  status: "online" | "offline",
  pendingCount: number,
  attentionCount = 0,
  isTransmitting = false
) {
  return connectivityStatusViewModel({
    attentionCount,
    completionSequence: 0,
    isTransmitting,
    now: NOW,
    onlineUntil: null,
    pendingCount,
    status
  });
}

function contrastRatio(left: string, right: string) {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((channel) => channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}
