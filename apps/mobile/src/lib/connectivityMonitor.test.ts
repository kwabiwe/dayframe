import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const netInfo = vi.hoisted(() => {
  let listener: ((state: unknown) => void) | null = null;
  return {
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
    await vi.advanceTimersByTimeAsync(600);
    expect(netInfo.fetch).toHaveBeenCalledTimes(1);
    expect(monitor.getConnectivitySnapshot()).toMatchObject({
      status: "online",
      reconnectEpoch: 0,
      reconnectNoticeId: null
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
    await vi.advanceTimersByTimeAsync(600);
    expect(monitor.getConnectivitySnapshot().status).toBe("online");
    stop();
  });

  it("confirms reconnect once and dismisses only that notice after 2.5 seconds", async () => {
    netInfo.fetch.mockResolvedValueOnce(OFFLINE);
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(300);
    netInfo.emit(ONLINE);
    await vi.advanceTimersByTimeAsync(600);
    expect(monitor.getConnectivitySnapshot()).toMatchObject({
      status: "online",
      reconnectEpoch: 1,
      reconnectNoticeId: 1
    });

    await vi.advanceTimersByTimeAsync(2_499);
    expect(monitor.getConnectivitySnapshot().reconnectNoticeId).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(monitor.getConnectivitySnapshot().reconnectNoticeId).toBeNull();
    stop();
  });

  it("keeps a newer offline state safe from a stale reconnect timer", async () => {
    netInfo.fetch.mockResolvedValueOnce(OFFLINE);
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(300);
    netInfo.emit(ONLINE);
    await vi.advanceTimersByTimeAsync(600);
    netInfo.emit(OFFLINE);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(monitor.getConnectivitySnapshot()).toMatchObject({
      status: "offline",
      reconnectNoticeId: null
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

  it("coalesces transport-failure refreshes without directly setting offline", async () => {
    const stop = monitor.startConnectivityMonitor();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(600);
    netInfo.refresh.mockClear();

    monitor.reportHttpTransportFailure();
    monitor.reportHttpTransportFailure();
    await vi.runAllTicks();
    expect(netInfo.refresh).toHaveBeenCalledTimes(1);
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
    await vi.advanceTimersByTimeAsync(600);
    const requestGeneration = monitor.connectivityRequestGeneration();
    netInfo.emit(OFFLINE);
    await vi.advanceTimersByTimeAsync(300);
    monitor.reportHttpTransportResponse({ requestGeneration });
    expect(monitor.getConnectivitySnapshot().status).toBe("offline");
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
