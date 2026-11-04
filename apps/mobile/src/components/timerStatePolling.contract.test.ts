import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ScriptTarget, transpileModule } from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { timerStateChanged, timerStatePollDelay, type TimerStateFingerprint } from "@dayframe/shared";

const dashboardSource = readFileSync(
  fileURLToPath(new URL("./DayframeDashboard.tsx", import.meta.url)),
  "utf8"
);

describe("mobile timer-state polling contracts", () => {
  it("checks only while active and reconciles through the guarded dashboard loader", () => {
    expect(dashboardSource).toContain("const fetched = await fetchTimerState()");
    expect(dashboardSource).toContain(
      "await reconcilePendingActiveDeletionAfterQueueBarrier(\n          fetched.activeEntryId"
    );
    expect(dashboardSource).toContain("tombstones.has(fetched.activeEntryId)");
    expect(dashboardSource).toContain("timerStateChanged(timerStateRef.current, next)");
    expect(dashboardSource).toContain("await loadRef.current({ silent: true })");
    expect(dashboardSource).toContain('AppState.currentState !== "active"');
    expect(dashboardSource).toContain('if (state === "active")');
  });

  it("allows one timer-state request at a time and backs failures off", () => {
    expect(dashboardSource).toContain("timerStatePollInFlight.current");
    expect(dashboardSource).toContain("timerStatePollDelay(consecutiveFailures)");
    expect(dashboardSource).toContain("TIMER_STATE_RECONCILE_INTERVAL_MS");
    expect(dashboardSource).not.toContain("}, 30000);");
  });
});

// Exercise the Dashboard's actual poll effect without mounting its native views, like the
// Settings queue race test. Only the network, app state and guarded loader are replaced.
const fetchIndex = dashboardSource.indexOf("const fetched = await fetchTimerState()");
const effectStart = dashboardSource.lastIndexOf("\n  useEffect(() => {", fetchIndex);
const effectClose = "\n  }, [authState, transitionToSignedOut]);";
const effectEnd = dashboardSource.indexOf(effectClose, fetchIndex) + effectClose.length;
const runPollEffect = new Function(
  "useEffect", "authState", "authStateCurrent", "AppState", "timerStateRef", "timerStatePollInFlight",
  "fetchTimerState", "reconcilePendingActiveDeletionAfterQueueBarrier", "timerStateChanged", "timerStatePollDelay",
  "loadRef", "transitionToSignedOut", "currentSessionGeneration", "currentMobileAccountEpoch", "AuthRequiredError",
  transpileModule(dashboardSource.slice(effectStart, effectEnd), {
    compilerOptions: { target: ScriptTarget.ES2022 }
  }).outputText
);

// Use the real entry guard as well when a manual bootstrap already owns the loader.
// Stop the probe at the boundary where an admitted call would issue its bootstrap.
const loadStart = dashboardSource.indexOf("  const load = useCallback(async (options?: DashboardLoadOptions)");
const loadGuardEnd = dashboardSource.indexOf("    refreshInFlight.current = true;", loadStart);
const createGuardedLoader = new Function(
  "useCallback", "applyWaitingLockScreenStops", "connectivityCurrent", "latestData",
  "refreshInFlight", "timerMutationCount", "refreshQueued", "transitionToSignedOut",
  transpileModule(`${dashboardSource.slice(loadStart, loadGuardEnd)}
    return true;
  }, [applyWaitingLockScreenStops, transitionToSignedOut]);
  return load;`, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText
);

const before: TimerStateFingerprint = {
  activeEntryId: "recording-on-web",
  updatedAt: "2026-11-04T08:30:00Z",
  serverNow: "2026-11-04T09:00:00Z"
};
const stopped: TimerStateFingerprint = {
  activeEntryId: null,
  updatedAt: null,
  serverNow: "2026-11-04T09:00:03Z"
};

function startPoll(pollInFlight = { current: false }) {
  vi.useFakeTimers();
  let cleanup: (() => void) | undefined;
  let sessionGeneration = 1;
  const fingerprint = { current: before };
  const fetchTimerState = vi.fn<() => Promise<TimerStateFingerprint>>().mockResolvedValue(stopped);
  const reconcileDeletion = vi.fn(async (_entryId: string | null) => new Set<string>());
  const load = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  runPollEffect(
    (effect: () => () => void) => { cleanup = effect(); },
    "authenticated",
    { current: "authenticated" },
    { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
    fingerprint,
    pollInFlight,
    fetchTimerState,
    reconcileDeletion,
    timerStateChanged,
    timerStatePollDelay,
    { current: load },
    vi.fn(),
    () => sessionGeneration,
    () => 1,
    class AuthRequiredError extends Error {}
  );
  return { fingerprint, fetchTimerState, reconcileDeletion, load, cleanup, replaceSession: () => { sessionGeneration += 1; } };
}

describe("foreground timer-state reconciliation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("backs off a failed bootstrap and retries the same web Stop until it applies", async () => {
    const poll = startPoll();
    try {
      poll.load.mockResolvedValueOnce(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(poll.load).toHaveBeenCalledOnce();
      expect(poll.fingerprint.current).toBe(before);

      await vi.advanceTimersByTimeAsync(5_999);
      expect(poll.fetchTimerState).toHaveBeenCalledOnce();
      expect(poll.load).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);
      expect(poll.load).toHaveBeenCalledTimes(2);
      expect(poll.fingerprint.current).toBe(stopped);

      await vi.advanceTimersByTimeAsync(3_000);
      expect(poll.fetchTimerState).toHaveBeenCalledTimes(3);
      expect(poll.load).toHaveBeenCalledTimes(2);
    } finally {
      poll.cleanup?.();
    }
  });

  it("keeps the fingerprint pending when the real loader coalesces with a manual refresh", async () => {
    const manualRefreshInFlight = { current: true };
    const refreshQueued = { current: false };
    const poll = startPoll();
    try {
      poll.load.mockImplementation(createGuardedLoader(
        (load: () => Promise<boolean>) => load,
        async () => undefined,
        { current: { isOffline: false } },
        { current: {} },
        manualRefreshInFlight,
        { current: 0 },
        refreshQueued,
        vi.fn()
      ));
      await vi.advanceTimersByTimeAsync(0);
      expect(refreshQueued.current).toBe(true);
      expect(poll.fingerprint.current).toBe(before);
      // The manual read was older than the web Stop and the coalesced read did not apply.
      manualRefreshInFlight.current = false;
      await vi.advanceTimersByTimeAsync(6_000);
      expect(poll.load).toHaveBeenCalledTimes(2);
      expect(poll.fingerprint.current).toBe(stopped);
    } finally {
      poll.cleanup?.();
    }
  });

  it("keeps the new session's poll scheduled while an older effect owns the request", async () => {
    const oldPollInFlight = { current: true };
    const poll = startPoll(oldPollInFlight);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(poll.fetchTimerState).not.toHaveBeenCalled();

      oldPollInFlight.current = false;
      await vi.advanceTimersByTimeAsync(3_000);
      expect(poll.fetchTimerState).toHaveBeenCalledOnce();
      expect(poll.fingerprint.current).toBe(stopped);
    } finally {
      poll.cleanup?.();
    }
  });

  it("discards a successful fingerprint when its authenticated session was replaced", async () => {
    const poll = startPoll();
    try {
      let respond!: (state: TimerStateFingerprint) => void;
      poll.fetchTimerState.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
      await vi.advanceTimersByTimeAsync(0);
      poll.replaceSession();
      respond(stopped);
      await vi.advanceTimersByTimeAsync(0);
      expect(poll.reconcileDeletion).not.toHaveBeenCalled();
      expect(poll.load).not.toHaveBeenCalled();
      expect(poll.fingerprint.current).toBe(before);
    } finally {
      poll.cleanup?.();
    }
  });
});
