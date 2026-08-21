import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTIVITY_OFFLINE_CONFIRM_MS,
  CONNECTIVITY_ONLINE_CONFIRM_MS,
  classifyConnectivityCandidate,
  confirmHttpConnectivity,
  confirmNativeConnectivity,
  connectivityBannerViewModel,
  connectivitySnapshot,
  createConnectivityMachineState,
  dismissConnectivityReconnectNotice,
  observeNativeConnectivity,
  type ConnectivityMachineState,
  type RawConnectivityObservation
} from "./connectivityState";

const ONLINE: RawConnectivityObservation = {
  isConnected: true,
  isInternetReachable: true,
  connectionType: "wifi"
};
const OFFLINE: RawConnectivityObservation = {
  isConnected: false,
  isInternetReachable: false,
  connectionType: "none"
};
const AMBIGUOUS: RawConnectivityObservation = {
  isConnected: null,
  isInternetReachable: null,
  connectionType: "unknown"
};

describe("connectivity state machine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T09:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts unknown without a banner", () => {
    const state = createConnectivityMachineState();
    expect(connectivitySnapshot(state)).toMatchObject({
      status: "unknown",
      reconnectEpoch: 0,
      reconnectNoticeId: null
    });
    expect(connectivityBannerViewModel(connectivitySnapshot(state))).toBeNull();
  });

  it("commits initial online without a reconnect notice", () => {
    const state = confirmObserved(
      createConnectivityMachineState(),
      ONLINE,
      CONNECTIVITY_ONLINE_CONFIRM_MS
    );
    expect(state).toMatchObject({
      status: "online",
      reconnectEpoch: 0,
      reconnectNoticeId: null
    });
  });

  it("commits initial offline after the confirmation interval", () => {
    const state = confirmObserved(
      createConnectivityMachineState(),
      OFFLINE,
      CONNECTIVITY_OFFLINE_CONFIRM_MS
    );
    expect(state.status).toBe("offline");
    expect(connectivityBannerViewModel(connectivitySnapshot(state))).toMatchObject({
      title: "You’re offline",
      body: "Changes will sync when you’re back online",
      variant: "offline"
    });
  });

  it("rejects a stale offline candidate cancelled by a later handover observation", () => {
    const offline = observeNativeConnectivity(
      createConnectivityMachineState(),
      OFFLINE,
      "native"
    );
    const online = observeNativeConnectivity(offline.state, ONLINE, "native");
    const staleConfirmation = confirmNativeConnectivity({
      candidate: "offline",
      candidateRevision: offline.candidateRevision,
      confirmedAt: Date.now() + CONNECTIVITY_OFFLINE_CONFIRM_MS,
      state: online.state
    });
    expect(staleConfirmation.status).toBe("unknown");
  });

  it("classifies an ordinary Wi-Fi to cellular handover as online", () => {
    expect(classifyConnectivityCandidate({
      isConnected: true,
      isInternetReachable: null,
      connectionType: "cellular"
    })).toBe("online");
  });

  it("increments the reconnect epoch and notice exactly once", () => {
    const offline = confirmedOffline();
    const online = confirmObserved(offline, ONLINE, CONNECTIVITY_ONLINE_CONFIRM_MS);
    const duplicate = confirmObserved(online, ONLINE, CONNECTIVITY_ONLINE_CONFIRM_MS);
    expect(online).toMatchObject({
      status: "online",
      reconnectEpoch: 1,
      reconnectNoticeId: 1
    });
    expect(duplicate).toMatchObject({
      reconnectEpoch: 1,
      reconnectNoticeId: 1
    });
  });

  it("preserves confirmed offline status through an ambiguous observation", () => {
    const offline = confirmedOffline();
    const ambiguous = observeNativeConnectivity(offline, AMBIGUOUS, "native");
    expect(ambiguous.candidate).toBe("ambiguous");
    expect(ambiguous.state.status).toBe("offline");
  });

  it("lets confirmed offline supersede an active reconnect notice", () => {
    const reconnected = confirmedReconnect();
    const offline = confirmObserved(
      reconnected,
      OFFLINE,
      CONNECTIVITY_OFFLINE_CONFIRM_MS
    );
    expect(offline).toMatchObject({ status: "offline", reconnectNoticeId: null });
  });

  it("ignores a stale notice dismissal after a newer offline state", () => {
    const reconnected = confirmedReconnect();
    const noticeId = reconnected.reconnectNoticeId!;
    const offline = confirmObserved(
      reconnected,
      OFFLINE,
      CONNECTIVITY_OFFLINE_CONFIRM_MS
    );
    expect(dismissConnectivityReconnectNotice(offline, noticeId)).toBe(offline);
  });

  it("assigns a newer notice ID to a second reconnect", () => {
    const firstReconnect = confirmedReconnect();
    const secondOffline = confirmObserved(
      firstReconnect,
      OFFLINE,
      CONNECTIVITY_OFFLINE_CONFIRM_MS
    );
    const secondReconnect = confirmObserved(
      secondOffline,
      ONLINE,
      CONNECTIVITY_ONLINE_CONFIRM_MS
    );
    expect(secondReconnect.reconnectNoticeId).toBe(2);
    expect(secondReconnect.reconnectEpoch).toBe(2);
  });

  it("prevents a pre-offline HTTP request from overriding newer offline evidence", () => {
    const online = confirmedOnline();
    const requestGeneration = online.requestGeneration;
    const offlineObservation = observeNativeConnectivity(online, OFFLINE, "native");
    const offline = confirmNativeConnectivity({
      candidate: "offline",
      candidateRevision: offlineObservation.candidateRevision,
      confirmedAt: Date.now() + CONNECTIVITY_OFFLINE_CONFIRM_MS,
      state: offlineObservation.state
    });
    const response = confirmHttpConnectivity({
      completedAt: Date.now() + 2_000,
      requestGeneration,
      state: offline
    });
    expect(response.accepted).toBe(false);
    expect(response.state.status).toBe("offline");
  });

  it("advances request generation only when offline is confirmed", () => {
    const online = confirmedOnline();
    const observed = observeNativeConnectivity(online, OFFLINE, "native");
    expect(observed.state.requestGeneration).toBe(online.requestGeneration);
    const offline = confirmNativeConnectivity({
      candidate: "offline",
      candidateRevision: observed.candidateRevision,
      confirmedAt: Date.now() + CONNECTIVITY_OFFLINE_CONFIRM_MS,
      state: observed.state
    });
    expect(offline.requestGeneration).toBe(online.requestGeneration + 1);
  });

  it("lets a current HTTP response immediately confirm transport online", () => {
    const offlineObservation = observeNativeConnectivity(
      confirmedOnline(),
      OFFLINE,
      "native"
    );
    const response = confirmHttpConnectivity({
      completedAt: Date.now() + 1,
      requestGeneration: offlineObservation.state.requestGeneration,
      state: offlineObservation.state
    });
    expect(response.accepted).toBe(true);
    expect(response.state.status).toBe("online");
  });

  it("keeps timeout and cancellation outside direct connectivity transitions", () => {
    const state = confirmedOnline();
    expect(state.status).toBe("online");
    expect(state.requestGeneration).toBe(0);
  });
});

function confirmObserved(
  state: ConnectivityMachineState,
  observation: RawConnectivityObservation,
  delay: number
) {
  const observed = observeNativeConnectivity(state, observation, "native");
  if (observed.candidate === "ambiguous") return observed.state;
  vi.advanceTimersByTime(delay);
  return confirmNativeConnectivity({
    candidate: observed.candidate,
    candidateRevision: observed.candidateRevision,
    confirmedAt: Date.now(),
    state: observed.state
  });
}

function confirmedOnline() {
  return confirmObserved(
    createConnectivityMachineState(),
    ONLINE,
    CONNECTIVITY_ONLINE_CONFIRM_MS
  );
}

function confirmedOffline() {
  return confirmObserved(
    createConnectivityMachineState(),
    OFFLINE,
    CONNECTIVITY_OFFLINE_CONFIRM_MS
  );
}

function confirmedReconnect() {
  return confirmObserved(
    confirmedOffline(),
    ONLINE,
    CONNECTIVITY_ONLINE_CONFIRM_MS
  );
}
