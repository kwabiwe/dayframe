import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectivityAllowsRecovery,
  connectivityRecoveryRequest,
  createConnectivityRecoveryCoordinator,
  createSharedInFlightOperation,
  foregroundRecoveryRequest,
  locationConnectivityRecoveryStepResult,
  reviewConnectivityRecoveryStepResult,
  runConnectivityRecoveryPass,
  shouldRetryConnectivityRecovery,
  type ConnectivityRecoveryStepName
} from "./connectivityRecovery";

const ORDER: ConnectivityRecoveryStepName[] = [
  "timer_stops_ready",
  "activity_queue",
  "time_entry_outbox",
  "timer_stops_after_correlation",
  "review_outbox",
  "location_intelligence",
  "bootstrap"
];

describe("connectivity recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps bounded recovery available for HTTP-forced Offline only", () => {
    expect(connectivityAllowsRecovery({
      isConnected: true,
      isInternetReachable: true,
      source: "http",
      status: "offline"
    })).toBe(true);
    expect(connectivityAllowsRecovery({
      isConnected: false,
      isInternetReachable: false,
      source: "native",
      status: "offline"
    })).toBe(false);
    expect(connectivityAllowsRecovery({
      isConnected: true,
      isInternetReachable: false,
      source: "http",
      status: "offline"
    })).toBe(false);
  });

  it("backs off through HTTP-forced Offline and recovers without a native toggle", async () => {
    vi.useFakeTimers();
    let connectivity: Parameters<typeof connectivityAllowsRecovery>[0] = {
      isConnected: true,
      isInternetReachable: true,
      source: "native",
      status: "online"
    };
    const runPass = vi.fn(async () => {
      if (runPass.mock.calls.length === 1) {
        connectivity = { ...connectivity, source: "http", status: "offline" };
        return "transport_failure" as const;
      }
      connectivity = { ...connectivity, source: "http", status: "online" };
      return "completed" as const;
    });
    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => connectivityAllowsRecovery(connectivity),
      random: () => 0.5,
      runPass
    });

    await coordinator.request(1);
    expect(connectivity.status).toBe("offline");
    expect(coordinator.snapshot()).toMatchObject({
      retryAttempt: 1,
      retryAt: Date.now() + 1_000
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(connectivity.status).toBe("online");
    expect(runPass).toHaveBeenCalledTimes(2);
    expect(coordinator.snapshot()).toMatchObject({ retryAttempt: 0, retryAt: null });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(runPass).toHaveBeenCalledTimes(2);
  });
  it("requests reconnect and foreground recovery with zero durable work", async () => {
    expect(connectivityRecoveryRequest({
      accountKey: "workspace:user",
      appActive: true,
      isOnline: true,
      pendingCount: 0,
      reconnectEpoch: 3
    })).toEqual({ epoch: 3 });
    expect(foregroundRecoveryRequest({
      accountKey: "workspace:user",
      isOnline: true,
      reconnectEpoch: 0
    })).toEqual({ epoch: 0, options: { forcePass: true } });

    const runPass = vi.fn(async () => "completed" as const);
    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => true,
      runPass
    });
    await coordinator.request(0, { forcePass: true });
    expect(runPass).toHaveBeenCalledWith(0);
  });

  it("does not request zero-work recovery on ordinary online startup", () => {
    expect(connectivityRecoveryRequest({
      accountKey: "workspace:user",
      appActive: true,
      isOnline: true,
      pendingCount: 0,
      reconnectEpoch: 0
    })).toBeNull();
  });

  it("retries transport failure even when no durable count is visible", () => {
    expect(shouldRetryConnectivityRecovery("transport_failure", 0)).toBe(true);
    expect(shouldRetryConnectivityRecovery("failed", 0)).toBe(false);
    expect(shouldRetryConnectivityRecovery("failed", 1)).toBe(true);
    expect(shouldRetryConnectivityRecovery("authentication_required", 1)).toBe(false);
  });
  it("runs durable owners in the required dependency order", async () => {
    const calls: ConnectivityRecoveryStepName[] = [];
    const outcomes: string[] = [];
    const result = await runConnectivityRecoveryPass({
      canContinue: () => true,
      isAuthenticationRequired: () => false,
      isTransportFailure: () => false,
      onAuthenticationRequired: vi.fn(),
      onStepOutcome: ({ step, outcome }) => outcomes.push(`${step}:${outcome}`),
      steps: ORDER.map((name) => ({
        name,
        run: async () => {
          calls.push(name);
        }
      }))
    });
    expect(result).toBe("completed");
    expect(calls).toEqual(ORDER);
    expect(outcomes).toEqual(ORDER.map((step) => `${step}:completed`));
  });

  it("stops before later owners when connectivity is lost", async () => {
    let online = true;
    const calls: ConnectivityRecoveryStepName[] = [];
    const result = await runConnectivityRecoveryPass({
      canContinue: () => online,
      isAuthenticationRequired: () => false,
      isTransportFailure: () => false,
      onAuthenticationRequired: vi.fn(),
      steps: ORDER.map((name) => ({
        name,
        run: async () => {
          calls.push(name);
          if (name === "activity_queue") online = false;
        }
      }))
    });
    expect(result).toBe("interrupted");
    expect(calls).toEqual(["timer_stops_ready", "activity_queue"]);
  });

  it("stops on a transport failure but continues past an application error", async () => {
    const calls: ConnectivityRecoveryStepName[] = [];
    const errors: ConnectivityRecoveryStepName[] = [];
    const result = await runConnectivityRecoveryPass({
      canContinue: () => true,
      isAuthenticationRequired: () => false,
      isTransportFailure: (error) => error instanceof TypeError,
      onAuthenticationRequired: vi.fn(),
      onStepError: (name) => errors.push(name),
      steps: ORDER.map((name) => ({
        name,
        run: async () => {
          calls.push(name);
          if (name === "activity_queue") throw new Error("Permanent item rejected");
          if (name === "location_intelligence") {
            throw new TypeError("Network request failed");
          }
        }
      }))
    });
    expect(result).toBe("transport_failure");
    expect(errors).toEqual(["activity_queue"]);
    expect(calls).not.toContain("bootstrap");
  });

  it("awaits an existing activity drain before delivering a correlated Stop", async () => {
    const optimisticTimerId = "optimistic-active-timer:offline-start";
    const queuedActivityEvents = [{
      localId: optimisticTimerId,
      type: "timer_start" as const
    }];
    const pendingStops = [{
      clientEventId: "mobile-timer-stop:offline-stop",
      optimisticEntryId: optimisticTimerId
    }];
    const correlations = new Map<string, string>();
    const deliveredStopIds: string[] = [];
    const queueDrain = createSharedInFlightOperation<void>();
    const queueRelease = deferred<void>();
    const queueRuns = vi.fn(async () => {
      await queueRelease.promise;
      const start = queuedActivityEvents.shift();
      if (start) correlations.set(start.localId, "timer-canonical");
    });
    const deliverCorrelatedStops = () => {
      for (let index = pendingStops.length - 1; index >= 0; index -= 1) {
        const stop = pendingStops[index];
        if (!correlations.has(stop.optimisticEntryId)) continue;
        deliveredStopIds.push(stop.clientEventId);
        pendingStops.splice(index, 1);
      }
    };

    const foregroundDrain = queueDrain.run(queueRuns);
    const recovery = runConnectivityRecoveryPass({
      canContinue: () => true,
      isAuthenticationRequired: () => false,
      isTransportFailure: () => false,
      onAuthenticationRequired: vi.fn(),
      steps: [
        {
          name: "timer_stops_ready",
          run: async () => {
            deliverCorrelatedStops();
          }
        },
        {
          name: "activity_queue",
          run: async () => {
            await queueDrain.run(queueRuns);
          }
        },
        {
          name: "timer_stops_after_correlation",
          run: async () => {
            deliverCorrelatedStops();
          }
        }
      ]
    });

    await Promise.resolve();
    expect(queueRuns).toHaveBeenCalledOnce();
    expect(deliveredStopIds).toEqual([]);
    expect(pendingStops).toHaveLength(1);

    queueRelease.resolve();
    await Promise.all([foregroundDrain, recovery]);
    expect(queueRuns).toHaveBeenCalledOnce();
    expect(queuedActivityEvents).toEqual([]);
    expect(correlations.get(optimisticTimerId)).toBe("timer-canonical");
    expect(deliveredStopIds).toEqual(["mobile-timer-stop:offline-stop"]);
    expect(pendingStops).toEqual([]);
  });

  it("stops on a returned retryable Review failure", async () => {
    const calls: ConnectivityRecoveryStepName[] = [];
    const result = await runConnectivityRecoveryPass({
      canContinue: () => true,
      isAuthenticationRequired: () => false,
      isTransportFailure: () => false,
      onAuthenticationRequired: vi.fn(),
      steps: [
        {
          name: "review_outbox",
          run: async () => {
            calls.push("review_outbox");
            return reviewConnectivityRecoveryStepResult({
              reason: "retryable_failure"
            });
          }
        },
        {
          name: "location_intelligence",
          run: async () => {
            calls.push("location_intelligence");
          }
        }
      ]
    });

    expect(result).toBe("transport_failure");
    expect(calls).toEqual(["review_outbox"]);
  });

  it.each(["request_failed", "replay_failed"] as const)(
    "stops on a returned retryable Location failure: %s",
    async (reason) => {
      const calls: ConnectivityRecoveryStepName[] = [];
      const result = await runConnectivityRecoveryPass({
        canContinue: () => true,
        isAuthenticationRequired: () => false,
        isTransportFailure: () => false,
        onAuthenticationRequired: vi.fn(),
        steps: [
          {
            name: "location_intelligence",
            run: async () => {
              calls.push("location_intelligence");
              return locationConnectivityRecoveryStepResult({
                synced: false,
                reason
              });
            }
          },
          {
            name: "bootstrap",
            run: async () => {
              calls.push("bootstrap");
            }
          }
        ]
      });

      expect(result).toBe("transport_failure");
      expect(calls).toEqual(["location_intelligence"]);
    }
  );

  it("reports failed when an owner completes with queued or permanent work remaining", async () => {
    const calls: ConnectivityRecoveryStepName[] = [];
    const result = await runConnectivityRecoveryPass({
      canContinue: () => true,
      isAuthenticationRequired: () => false,
      isTransportFailure: () => false,
      onAuthenticationRequired: vi.fn(),
      steps: [
        {
          name: "review_outbox",
          run: async () => {
            calls.push("review_outbox");
            return reviewConnectivityRecoveryStepResult({
              waitingCount: 1,
              needsAttentionCount: 0
            });
          }
        },
        {
          name: "location_intelligence",
          run: async () => {
            calls.push("location_intelligence");
            return locationConnectivityRecoveryStepResult({
              synced: false,
              reason: "invalid_batch"
            });
          }
        },
        {
          name: "bootstrap",
          run: async () => {
            calls.push("bootstrap");
          }
        }
      ]
    });

    expect(result).toBe("failed");
    expect(calls).toEqual(["review_outbox", "location_intelligence", "bootstrap"]);
  });

  it("publishes authentication failure and stops", async () => {
    const onAuthenticationRequired = vi.fn();
    const result = await runConnectivityRecoveryPass({
      canContinue: () => true,
      isAuthenticationRequired: (error) => error instanceof AuthTestError,
      isTransportFailure: () => false,
      onAuthenticationRequired,
      steps: [{
        name: "timer_stops_ready",
        run: async () => {
          throw new AuthTestError();
        }
      }]
    });
    expect(result).toBe("authentication_required");
    expect(onAuthenticationRequired).toHaveBeenCalledTimes(1);
  });

  it("does not run for initial online, signed-out, or background states", async () => {
    let canStart = false;
    const runPass = vi.fn(async () => "completed" as const);
    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => canStart,
      runPass
    });
    await coordinator.request(0);
    await coordinator.request(1);
    expect(runPass).not.toHaveBeenCalled();

    canStart = true;
    coordinator.ignore(1);
    await coordinator.request(1);
    expect(runPass).not.toHaveBeenCalled();
    await coordinator.request(2);
    expect(runPass).toHaveBeenCalledOnce();
  });

  it("coalesces duplicate epochs and queues only the latest newer epoch", async () => {
    const firstPass = deferred<"completed">();
    const calls: number[] = [];
    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => true,
      runPass: vi.fn(async (epoch) => {
        calls.push(epoch);
        if (epoch === 1) return firstPass.promise;
        return "completed" as const;
      })
    });

    const recovery = coordinator.request(1);
    void coordinator.request(1);
    void coordinator.request(2);
    void coordinator.request(3);
    expect(calls).toEqual([1]);
    expect(coordinator.snapshot()).toMatchObject({
      inFlight: true,
      lastHandledReconnectEpoch: 1,
      queuedReconnectEpoch: 3
    });

    firstPass.resolve("completed");
    await recovery;
    expect(calls).toEqual([1, 3]);
    expect(coordinator.snapshot()).toMatchObject({
      inFlight: false,
      lastHandledReconnectEpoch: 3,
      queuedReconnectEpoch: 0
    });
  });

  it("drops a same-epoch queued-work rerun when account ownership is ignored", async () => {
    let canStart = true;
    const firstPass = deferred<"completed">();
    const calls: number[] = [];
    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => canStart,
      runPass: vi.fn(async (epoch) => {
        calls.push(epoch);
        return firstPass.promise;
      })
    });

    const recovery = coordinator.request(1);
    void coordinator.request(1, { queuedWorkArrived: true });
    canStart = false;
    coordinator.ignore(1);
    firstPass.resolve("completed");
    await recovery;

    expect(calls).toEqual([1]);
    expect(coordinator.snapshot()).toMatchObject({
      inFlight: false,
      queuedReconnectEpoch: 0,
      queuedWorkPending: false
    });
  });

  it("retains an interrupted epoch for one serialized foreground resume", async () => {
    let canStart = true;
    const calls: number[] = [];
    const finishes: Array<{ hasPendingPass: boolean; result: string }> = [];
    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => canStart,
      onPassFinished: ({ hasPendingPass, result }) => {
        finishes.push({ hasPendingPass, result });
      },
      runPass: vi.fn(async (epoch) => {
        calls.push(epoch);
        if (calls.length === 1) {
          canStart = false;
          return "interrupted" as const;
        }
        return "completed" as const;
      })
    });

    await coordinator.request(1);
    expect(coordinator.snapshot()).toMatchObject({
      inFlight: false,
      interruptedReconnectEpoch: 1
    });

    canStart = true;
    await coordinator.request(1);
    expect(calls).toEqual([1, 1]);
    expect(finishes).toEqual([
      { hasPendingPass: true, result: "interrupted" },
      { hasPendingPass: false, result: "completed" }
    ]);
    expect(coordinator.snapshot().interruptedReconnectEpoch).toBe(0);
  });

  it("yields after an interruption even when the start gate is briefly stale", async () => {
    const calls: number[] = [];
    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => true,
      runPass: vi.fn(async (epoch) => {
        calls.push(epoch);
        return calls.length === 1 ? "interrupted" as const : "completed" as const;
      })
    });

    await coordinator.request(1);

    expect(calls).toEqual([1]);
    expect(coordinator.snapshot()).toMatchObject({
      inFlight: false,
      interruptedReconnectEpoch: 1
    });

    await coordinator.request(1);
    expect(calls).toEqual([1, 1]);
    expect(coordinator.snapshot().interruptedReconnectEpoch).toBe(0);
  });

  it("schedules bounded exponential backoff for retryable transport failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T12:00:00.000Z"));
    const results = ["transport_failure", "completed"] as const;
    const runPass = vi.fn(async () => results[Math.min(runPass.mock.calls.length - 1, 1)]);
    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => true,
      random: () => 0.5,
      runPass,
      shouldRetry: (result) => result === "transport_failure"
    });

    await coordinator.request(1);
    expect(runPass).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot()).toMatchObject({
      retryAttempt: 1,
      retryAt: Date.now() + 1_000
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(runPass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runPass).toHaveBeenCalledTimes(2);
    expect(coordinator.snapshot()).toMatchObject({ retryAttempt: 0, retryAt: null });
  });

  it("cancels the retry timer while confirmed offline", async () => {
    vi.useFakeTimers();
    const runPass = vi.fn(async () => "transport_failure" as const);
    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => true,
      random: () => 0.5,
      runPass
    });
    await coordinator.request(1);
    expect(vi.getTimerCount()).toBe(1);
    coordinator.pause();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runPass).toHaveBeenCalledTimes(1);
  });

  it("lets a newer reconnect epoch supersede an obsolete retry", async () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => true,
      random: () => 0.5,
      runPass: vi.fn(async (epoch) => {
        calls.push(epoch);
        return epoch === 1 ? "transport_failure" as const : "completed" as const;
      })
    });
    await coordinator.request(1);
    expect(vi.getTimerCount()).toBe(1);
    await coordinator.request(2);
    expect(calls).toEqual([1, 2]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toEqual([1, 2]);
  });

  it("cancels a scheduled retry after a successful forced recovery pass", async () => {
    vi.useFakeTimers();
    const runPass = vi.fn(async () =>
      runPass.mock.calls.length === 1 ? "transport_failure" as const : "completed" as const
    );
    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => true,
      random: () => 0.5,
      runPass
    });

    await coordinator.request(1);
    expect(coordinator.snapshot()).toMatchObject({ retryAttempt: 1 });
    expect(vi.getTimerCount()).toBe(1);

    await coordinator.request(1, { forcePass: true });
    expect(runPass).toHaveBeenCalledTimes(2);
    expect(coordinator.snapshot()).toMatchObject({ retryAttempt: 0, retryAt: null });
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(runPass).toHaveBeenCalledTimes(2);
  });

  it("treats normal retry wait as pending work rather than a terminal outcome", async () => {
    vi.useFakeTimers();
    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => true,
      random: () => 0.5,
      runPass: vi.fn(async () => "failed" as const),
      shouldRetry: (result) => result === "failed"
    });
    await coordinator.request(0, { queuedWorkArrived: true });
    expect(coordinator.snapshot()).toMatchObject({
      lastHandledReconnectEpoch: 0,
      retryAttempt: 1
    });
    expect(vi.getTimerCount()).toBe(1);
  });

  it("schedules a bounded follow-up when fresh durable work survives a completed pass", async () => {
    vi.useFakeTimers();
    let pendingCount = 1;
    const runPass = vi.fn(async () => "completed" as const);
    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => true,
      random: () => 0.5,
      runPass,
      shouldRetry: (result) => result === "completed" && pendingCount > 0
    });

    await coordinator.request(1);
    expect(runPass).toHaveBeenCalledOnce();
    expect(coordinator.snapshot()).toMatchObject({
      retryAttempt: 1,
      retryAt: Date.now() + 1_000
    });

    pendingCount = 0;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runPass).toHaveBeenCalledTimes(2);
    expect(coordinator.snapshot()).toMatchObject({ retryAttempt: 0, retryAt: null });
  });

  it("keeps increasing backoff while the same durable work remains", async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    let pendingCount = 1;
    const retrySchedules: Array<{ attempt: number; retryAt: number }> = [];
    const runPass = vi.fn(async () => "completed" as const);
    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => true,
      onRetryScheduled: ({ attempt, retryAt }) => {
        retrySchedules.push({ attempt, retryAt });
      },
      random: () => 0.5,
      runPass,
      shouldRetry: () => pendingCount > 0
    });

    await coordinator.request(0, { queuedWorkArrived: true });
    expect(coordinator.snapshot().retryAttempt).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(coordinator.snapshot().retryAttempt).toBe(2);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(coordinator.snapshot().retryAttempt).toBe(3);
    expect(runPass).toHaveBeenCalledTimes(3);
    expect(retrySchedules.map(({ attempt }) => attempt)).toEqual([1, 2, 3]);
    expect(retrySchedules.map(({ retryAt }, index) =>
      retryAt - [startedAt, startedAt + 1_000, startedAt + 3_500][index]
    ))
      .toEqual([1_000, 2_500, 5_000]);

    pendingCount = 0;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runPass).toHaveBeenCalledTimes(4);
    expect(coordinator.snapshot()).toMatchObject({ retryAttempt: 0, retryAt: null });
  });

  it("resets an existing retry epoch only for genuinely new work", async () => {
    vi.useFakeTimers();
    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => true,
      random: () => 0.5,
      runPass: vi.fn(async () => "failed" as const),
      shouldRetry: () => true
    });

    await coordinator.request(0, { queuedWorkArrived: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(coordinator.snapshot().retryAttempt).toBe(2);

    await coordinator.request(0, { queuedWorkArrived: true });
    expect(coordinator.snapshot()).toMatchObject({ retryAttempt: 1, retryAt: Date.now() + 1_000 });
  });

  it("does not reset the retry epoch while authentication interrupts remaining work", async () => {
    vi.useFakeTimers();
    let result: "failed" | "authentication_required" = "failed";
    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => true,
      hasPendingWork: () => true,
      random: () => 0.5,
      runPass: vi.fn(async () => result),
      shouldRetry: (passResult) => passResult === "failed"
    });

    await coordinator.request(0, { queuedWorkArrived: true });
    expect(coordinator.snapshot().retryAttempt).toBe(1);
    result = "authentication_required";
    await vi.advanceTimersByTimeAsync(1_000);
    expect(coordinator.snapshot()).toMatchObject({ retryAttempt: 1, retryAt: null });
  });

  it("replays an offline timer Start that becomes durable after reconnect already passed the queue", async () => {
    const optimisticTimerId = "optimistic-active-timer:late-offline-start";
    const canonicalTimerId = "timer-canonical-after-reconnect";
    const queuedStarts: string[] = [];
    const serverStarts: string[] = [];
    const correlations = new Map<string, string>();
    const firstBootstrapRelease = deferred<void>();
    const firstActivityDrainPassed = deferred<void>();
    const passFinishes: Array<{ hasPendingPass: boolean; result: string }> = [];
    let canonicalActiveTimerId: string | null = null;
    let passCount = 0;

    const coordinator = createConnectivityRecoveryCoordinator({
      canStart: () => true,
      onPassFinished: ({ hasPendingPass, result }) => {
        passFinishes.push({ hasPendingPass, result });
      },
      runPass: async () => {
        passCount += 1;
        const currentPass = passCount;
        return runConnectivityRecoveryPass({
          canContinue: () => true,
          isAuthenticationRequired: () => false,
          isTransportFailure: () => false,
          onAuthenticationRequired: vi.fn(),
          steps: [
            {
              name: "activity_queue",
              run: async () => {
                const queuedStart = queuedStarts.shift();
                if (queuedStart) {
                  serverStarts.push(queuedStart);
                  correlations.set(queuedStart, canonicalTimerId);
                }
                if (currentPass === 1) firstActivityDrainPassed.resolve();
              }
            },
            {
              name: "bootstrap",
              run: async () => {
                if (currentPass === 1) await firstBootstrapRelease.promise;
                canonicalActiveTimerId = correlations.get(optimisticTimerId) ?? null;
              }
            }
          ]
        });
      }
    });

    // Connectivity returns while the original offline Start request is still
    // timing out. The first recovery pass therefore sees an empty queue.
    const recovery = coordinator.request(1);
    await firstActivityDrainPassed.promise;

    // The request then fails, and the optimistic Start becomes durable. This
    // must schedule a same-epoch recovery after the current pass completes.
    queuedStarts.push(optimisticTimerId);
    void coordinator.request(1, { queuedWorkArrived: true });
    firstBootstrapRelease.resolve();
    await recovery;

    expect(passCount).toBe(2);
    expect(serverStarts).toEqual([optimisticTimerId]);
    expect(queuedStarts).toEqual([]);
    expect(correlations.get(optimisticTimerId)).toBe(canonicalTimerId);
    expect(canonicalActiveTimerId).toBe(canonicalTimerId);
    expect(passFinishes).toEqual([
      { hasPendingPass: true, result: "completed" },
      { hasPendingPass: false, result: "completed" }
    ]);
  });
});

class AuthTestError extends Error {}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
