import { describe, expect, it, vi } from "vitest";
import {
  createConnectivityRecoveryCoordinator,
  createSharedInFlightOperation,
  locationConnectivityRecoveryStepResult,
  reviewConnectivityRecoveryStepResult,
  runConnectivityRecoveryPass,
  type ConnectivityRecoveryStepName
} from "./connectivityRecovery";

const ORDER: ConnectivityRecoveryStepName[] = [
  "timer_stops_ready",
  "activity_queue",
  "timer_stops_after_correlation",
  "review_outbox",
  "location_intelligence",
  "bootstrap"
];

describe("connectivity recovery", () => {
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
