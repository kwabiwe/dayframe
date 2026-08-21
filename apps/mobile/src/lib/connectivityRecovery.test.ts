import { describe, expect, it, vi } from "vitest";
import {
  createConnectivityRecoveryCoordinator,
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
});

class AuthTestError extends Error {}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
