import { describe, expect, it } from "vitest";
import {
  connectivityPillViewModel,
  connectivityPillColorRoles,
  createConnectivityPresentationState,
  createDistinctConnectivityAnnouncementTracker,
  updateConnectivityPresentation
} from "./connectivityPresentation";

const NOW = Date.parse("2026-08-22T12:00:00.000Z");

describe("connectivity pill presentation", () => {
  it("renders no pill for settled online startup with no work", () => {
    expect(view("online", 0)).toBeNull();
  });

  it("renders the amber Offline state from confirmed offline truth", () => {
    expect(view("offline", 0)).toMatchObject({
      text: "Offline",
      variant: "offline"
    });
    expect(connectivityPillColorRoles("offline").background).toBe("warning");
  });

  it("renders persistent Syncing while online durable work exists, including epoch-zero startup", () => {
    expect(view("online", 3)).toMatchObject({
      text: "Syncing…",
      variant: "syncing"
    });
  });

  it("shows Online only for a non-zero to zero transition and expires after two seconds", () => {
    const initial = updateConnectivityPresentation({
      accountKey: "workspace:user",
      now: NOW,
      pendingCount: 2,
      state: createConnectivityPresentationState(),
      status: "online"
    });
    const completed = updateConnectivityPresentation({
      accountKey: "workspace:user",
      now: NOW + 10,
      pendingCount: 0,
      state: initial.state,
      status: "online"
    });
    expect(completed.viewModel).toMatchObject({ text: "Online", variant: "online" });

    const expired = updateConnectivityPresentation({
      accountKey: "workspace:user",
      now: NOW + 2_011,
      pendingCount: 0,
      state: completed.state,
      status: "online"
    });
    expect(expired.viewModel).toBeNull();
  });

  it("self-heals after an out-of-band drain without a recovery-pass verdict", () => {
    const syncing = updateConnectivityPresentation({
      accountKey: "workspace:user",
      now: NOW,
      pendingCount: 1,
      state: createConnectivityPresentationState(),
      status: "online"
    });
    const drained = updateConnectivityPresentation({
      accountKey: "workspace:user",
      now: NOW + 1,
      pendingCount: 0,
      state: syncing.state,
      status: "online"
    });
    expect(syncing.viewModel?.text).toBe("Syncing…");
    expect(drained.viewModel?.text).toBe("Online");
  });

  it("cannot emit removed pass-verdict wording", () => {
    const emitted = [
      view("offline", 0)?.text,
      view("online", 1)?.text,
      view("online", 0)?.text
    ].filter(Boolean);
    expect(emitted).toEqual(["Offline", "Syncing…"]);
  });

  it("announces each distinct visible transition once", () => {
    const tracker = createDistinctConnectivityAnnouncementTracker();
    const offline = view("offline", 0);
    const syncing = view("online", 1);
    expect(tracker.next(offline)).toBe("Offline. Changes will sync later.");
    expect(tracker.next(offline)).toBeNull();
    expect(tracker.next(syncing)).toBe("Syncing saved changes.");
    expect(tracker.next(syncing)).toBeNull();
    expect(tracker.next(null)).toBeNull();
    expect(tracker.next(offline)).toBe("Offline. Changes will sync later.");
  });
});

function view(status: "online" | "offline", pendingCount: number) {
  return connectivityPillViewModel({
    completionSequence: 0,
    now: NOW,
    onlineUntil: null,
    pendingCount,
    status
  });
}
