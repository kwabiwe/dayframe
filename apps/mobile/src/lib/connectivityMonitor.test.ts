import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const netInfo = vi.hoisted(() => {
  let listener: ((state: unknown) => void) | null = null;
  return {
    configure: vi.fn(),
    addEventListener: vi.fn((nextListener: (state: unknown) => void) => {
      listener = nextListener;
      return vi.fn(() => {
        if (listener === nextListener) listener = null;
      });
    }),
    emit: (state: unknown) => listener?.(state),
    fetch: vi.fn(),
    refresh: vi.fn()
  };
});

vi.mock("@react-native-community/netinfo", () => ({
  default: {
    configure: netInfo.configure,
    addEventListener: netInfo.addEventListener,
    fetch: netInfo.fetch,
    refresh: netInfo.refresh
  }
}));

const monitor = await import("./connectivityMonitor");

const ONLINE = {
  type: "wifi",
  isConnected: true,
  isInternetReachable: true,
  details: null
};
const OFFLINE = {
  type: "none",
  isConnected: false,
  isInternetReachable: false,
  details: null
};

describe("process-wide connectivity monitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T09:00:00.000Z"));
    netInfo.fetch.mockResolvedValue(ONLINE);
    netInfo.refresh.mockResolvedValue(ONLINE);
  });

  afterEach(() => {
    monitor.__resetConnectivityMonitorForTests();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("starts one native listener and cleans it up after the final owner stops", async () => {
    const stopFirst = monitor.startConnectivityMonitor();
    const stopSecond = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    expect(netInfo.addEventListener).toHaveBeenCalledTimes(1);
    const unsubscribe = netInfo.addEventListener.mock.results[0]?.value;

    stopFirst();
    expect(unsubscribe).not.toHaveBeenCalled();
    stopSecond();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("fetches initial state and does not emit a reconnect for initial online", async () => {
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(400);
    expect(netInfo.fetch).toHaveBeenCalledTimes(1);
    expect(monitor.getConnectivitySnapshot()).toMatchObject({
      status: "online",
      reconnectEpoch: 0,
      recoveryStatus: "idle"
    });
    stop();
  });

  it("publishes an epoch-zero queued-work transmission lifecycle", async () => {
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(400);

    monitor.reportConnectivityRecoveryStarted(0);
    expect(monitor.getConnectivitySnapshot()).toMatchObject({
      recoveryEpoch: 0,
      recoveryStatus: "syncing"
    });
    monitor.reportConnectivityRecoveryFinished({ epoch: 0, successful: false });
    expect(monitor.getConnectivitySnapshot()).toMatchObject({
      recoveryEpoch: 0,
      recoveryStatus: "failure"
    });
    stop();
  });

  it("debounces initial offline and cancels a transient candidate", async () => {
    netInfo.fetch.mockResolvedValueOnce(OFFLINE);
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(299);
    expect(monitor.getConnectivitySnapshot().status).toBe("unknown");

    netInfo.emit(ONLINE);
    await vi.advanceTimersByTimeAsync(400);
    expect(monitor.getConnectivitySnapshot().status).toBe("online");
    stop();
  });

  it("shows recovery success only after the owner reports completion and dismisses it after two seconds", async () => {
    netInfo.fetch.mockResolvedValueOnce(OFFLINE);
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(300);
    netInfo.emit(ONLINE);
    await vi.advanceTimersByTimeAsync(400);
    expect(monitor.getConnectivitySnapshot()).toMatchObject({
      status: "online",
      reconnectEpoch: 1,
      recoveryStatus: "idle"
    });
    monitor.reportConnectivityRecoveryStarted(1);
    expect(monitor.getConnectivitySnapshot().recoveryStatus).toBe("syncing");
    monitor.reportConnectivityRecoveryFinished({ epoch: 1, successful: true });
    expect(monitor.getConnectivitySnapshot().recoveryStatus).toBe("success");

    await vi.advanceTimersByTimeAsync(1_999);
    expect(monitor.getConnectivitySnapshot().recoveryStatus).toBe("success");
    await vi.advanceTimersByTimeAsync(1);
    expect(monitor.getConnectivitySnapshot().recoveryStatus).toBe("idle");
    stop();
  });

  it("keeps a newer offline state safe from a stale recovery-success timer", async () => {
    netInfo.fetch.mockResolvedValueOnce(OFFLINE);
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(300);
    netInfo.emit(ONLINE);
    await vi.advanceTimersByTimeAsync(400);
    monitor.reportConnectivityRecoveryStarted(1);
    monitor.reportConnectivityRecoveryFinished({ epoch: 1, successful: true });
    netInfo.emit(OFFLINE);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(monitor.getConnectivitySnapshot()).toMatchObject({
      status: "offline",
      recoveryStatus: "idle"
    });
    stop();
  });

  it("keeps a reported recovery failure visible instead of scheduling success dismissal", async () => {
    netInfo.fetch.mockResolvedValueOnce(OFFLINE);
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(300);
    netInfo.emit(ONLINE);
    await vi.advanceTimersByTimeAsync(400);
    monitor.reportConnectivityRecoveryStarted(1);
    monitor.reportConnectivityRecoveryFinished({ epoch: 1, successful: false });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(monitor.getConnectivitySnapshot()).toMatchObject({
      recoveryEpoch: 1,
      recoveryStatus: "failure"
    });
    stop();
  });

  it("clears account-owned recovery presentation when its epoch is cancelled", async () => {
    netInfo.fetch.mockResolvedValueOnce(OFFLINE);
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(300);
    netInfo.emit(ONLINE);
    await vi.advanceTimersByTimeAsync(400);
    monitor.reportConnectivityRecoveryStarted(1);
    monitor.reportConnectivityRecoveryCancelled(1);

    expect(monitor.getConnectivitySnapshot()).toMatchObject({
      recoveryEpoch: null,
      recoveryStatus: "idle"
    });
    stop();
  });

  it("shares one explicit refresh promise", async () => {
    let resolveRefresh!: (value: typeof ONLINE) => void;
    netInfo.refresh.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    const first = monitor.refreshConnectivity();
    const second = monitor.refreshConnectivity();
    expect(first).toBe(second);
    expect(netInfo.refresh).toHaveBeenCalledTimes(1);
    resolveRefresh(ONLINE);
    await first;
    stop();
  });

  it("uses repeated transport failures as negative evidence while coalescing refreshes", async () => {
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(400);
    netInfo.refresh.mockClear();

    const requestGeneration = monitor.connectivityRequestGeneration();
    monitor.reportHttpTransportFailure({ requestGeneration });
    monitor.reportHttpTransportFailure({ requestGeneration });
    await vi.runAllTicks();
    expect(netInfo.refresh).toHaveBeenCalledTimes(1);
    expect(monitor.getConnectivitySnapshot().status).toBe("offline");
    stop();
  });

  it("uses repeated request deadlines as negative connectivity evidence", async () => {
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(400);
    const requestGeneration = monitor.connectivityRequestGeneration();
    monitor.reportHttpTransportFailure({ kind: "deadline", requestGeneration });
    expect(monitor.getConnectivitySnapshot().status).toBe("online");
    monitor.reportHttpTransportFailure({ kind: "deadline", requestGeneration });
    expect(monitor.getConnectivitySnapshot().status).toBe("offline");
    stop();
  });

  it("does not let unchanged native online evidence undo HTTP-forced offline", async () => {
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(400);
    const forcedOfflineGeneration = monitor.connectivityRequestGeneration();

    monitor.reportHttpTransportFailure({ requestGeneration: forcedOfflineGeneration });
    monitor.reportHttpTransportFailure({ requestGeneration: forcedOfflineGeneration });
    await vi.runAllTicks();
    expect(monitor.getConnectivitySnapshot()).toMatchObject({
      status: "offline",
      reconnectEpoch: 0,
      source: "http"
    });

    await monitor.refreshConnectivity();
    await vi.advanceTimersByTimeAsync(400);
    expect(monitor.getConnectivitySnapshot()).toMatchObject({
      status: "offline",
      reconnectEpoch: 0
    });

    netInfo.emit(OFFLINE);
    netInfo.emit(ONLINE);
    await vi.advanceTimersByTimeAsync(400);
    expect(monitor.getConnectivitySnapshot()).toMatchObject({
      status: "online",
      reconnectEpoch: 1,
      source: "native"
    });
    expect(monitor.connectivityRequestGeneration()).toBeGreaterThan(forcedOfflineGeneration);

    monitor.reportHttpTransportFailure({ requestGeneration: forcedOfflineGeneration });
    monitor.reportHttpTransportFailure({ requestGeneration: forcedOfflineGeneration });
    expect(monitor.getConnectivitySnapshot().status).toBe("online");
    stop();
  });

  it("uses an HTTP response as immediate current transport evidence", async () => {
    netInfo.fetch.mockResolvedValueOnce(OFFLINE);
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(300);
    const requestGeneration = monitor.connectivityRequestGeneration();
    monitor.reportHttpTransportResponse({ requestGeneration });
    expect(monitor.getConnectivitySnapshot()).toMatchObject({
      status: "online",
      reconnectEpoch: 1,
      source: "http"
    });
    stop();
  });

  it("ignores a response from a request started before newer offline evidence", async () => {
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(400);
    const requestGeneration = monitor.connectivityRequestGeneration();
    netInfo.emit(OFFLINE);
    await vi.advanceTimersByTimeAsync(300);
    monitor.reportHttpTransportResponse({ requestGeneration });
    expect(monitor.getConnectivitySnapshot().status).toBe("offline");
    stop();
  });

  it("does not let a stale success clear current-generation failure evidence", async () => {
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(400);
    const staleGeneration = monitor.connectivityRequestGeneration();
    netInfo.emit(OFFLINE);
    await vi.advanceTimersByTimeAsync(300);
    const currentGeneration = monitor.connectivityRequestGeneration();
    monitor.reportHttpTransportResponse({ requestGeneration: currentGeneration });
    expect(monitor.getConnectivitySnapshot().status).toBe("online");
    const reconnectedGeneration = monitor.connectivityRequestGeneration();

    monitor.reportHttpTransportFailure({ requestGeneration: reconnectedGeneration });
    monitor.reportHttpTransportResponse({ requestGeneration: staleGeneration });
    monitor.reportHttpTransportFailure({ requestGeneration: reconnectedGeneration });

    expect(monitor.getConnectivitySnapshot().status).toBe("offline");
    stop();
  });

  it("ignores a failure from an offline request after reconnect advances the generation", async () => {
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(400);
    netInfo.emit(OFFLINE);
    await vi.advanceTimersByTimeAsync(300);
    const offlineRequestGeneration = monitor.connectivityRequestGeneration();
    netInfo.emit(ONLINE);
    await vi.advanceTimersByTimeAsync(400);
    expect(monitor.getConnectivitySnapshot()).toMatchObject({
      status: "online",
      reconnectEpoch: 1
    });
    expect(monitor.connectivityRequestGeneration()).toBeGreaterThan(offlineRequestGeneration);

    monitor.reportHttpTransportFailure({ requestGeneration: offlineRequestGeneration });
    monitor.reportHttpTransportFailure({ requestGeneration: offlineRequestGeneration });

    expect(monitor.getConnectivitySnapshot()).toMatchObject({
      status: "online",
      reconnectEpoch: 1
    });
    stop();
  });

  it("does not publish a pending native result after the final stop", async () => {
    let resolveFetch!: (value: typeof OFFLINE) => void;
    netInfo.fetch.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    const listener = vi.fn();
    const unsubscribeSnapshot = monitor.subscribeConnectivity(listener);
    const stop = monitor.startConnectivityMonitor();
    stop();
    resolveFetch(OFFLINE);
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(300);
    expect(listener).not.toHaveBeenCalled();
    expect(monitor.getConnectivitySnapshot().status).toBe("unknown");
    unsubscribeSnapshot();
  });

  it("does not retain duplicate listeners across remount-style cycles", () => {
    const firstStop = monitor.startConnectivityMonitor();
    const firstUnsubscribe = netInfo.addEventListener.mock.results[0]?.value;
    firstStop();
    const secondStop = monitor.startConnectivityMonitor();
    expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
    expect(netInfo.addEventListener).toHaveBeenCalledTimes(2);
    secondStop();
  });

  it("cleans transition timers when the final owner stops", async () => {
    netInfo.fetch.mockResolvedValueOnce(OFFLINE);
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
