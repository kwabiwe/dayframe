import { afterEach, describe, expect, it, vi } from "vitest";
import { runManualSync, manualSyncSummary, type ManualSyncOperations } from "./syncCoordinator";

function operations(): ManualSyncOperations {
  const complete = () => vi.fn(async () => ({ outcome: "complete" as const }));
  return {
    sleep: complete(),
    workouts: complete(),
    activity: complete(),
    review: complete(),
    location: complete(),
    healthDelivery: complete(),
    healthReprocess: complete(),
    refresh: complete(),
    classifyError: () => "server_busy"
  };
}
afterEach(() => vi.useRealTimers());
describe("deliberate manual sync dependency graph", () => {
  it("delivers workouts and Location while sleep hangs and Review is busy", async () => {
    vi.useFakeTimers();
    const steps = operations();
    steps.sleep = () => new Promise(() => {});
    steps.review = async () => ({ outcome: "server_busy" });
    const pass = runManualSync(steps, { isCurrent: () => true });
    await vi.advanceTimersByTimeAsync(1);
    expect(steps.healthDelivery).toHaveBeenCalledOnce();
    expect(steps.location).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(45_000);
    const result = await pass;
    expect(result.lanes.sleep.outcome).toBe("cancelled");
    expect(result.lanes.workouts.outcome).toBe("complete");
    expect(result.lanes.review.outcome).toBe("server_busy");
    expect(manualSyncSummary(result)).toContain("Sleep: unfinished");
  });
  it("does not gate local capture on an activity transport failure", async () => {
    const steps = operations();
    steps.activity = async () => ({ outcome: "transport_failure" });
    const result = await runManualSync(steps, { isCurrent: () => true });
    expect(steps.sleep).toHaveBeenCalledOnce();
    expect(steps.workouts).toHaveBeenCalledOnce();
    expect(result.lanes.activity.outcome).toBe("transport_failure");
    expect(steps.refresh).toHaveBeenCalled();
  });
  it("queues a canonical follow-up while a data-changing lane completes during refresh", async () => {
    const steps = operations();
    let completeRefresh!: () => void;
    let completeLocation!: () => void;
    steps.sleep = async () => ({ outcome: "complete", stage: "disabled" });
    steps.workouts = steps.sleep;
    steps.activity = async () => ({ outcome: "complete", changed: true });
    steps.location = () =>
      new Promise((resolve) => {
        completeLocation = () => resolve({ outcome: "partial", changed: true });
      });
    steps.refresh = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            completeRefresh = () => resolve({ outcome: "complete" });
          })
      )
      .mockResolvedValue({ outcome: "complete" });
    const pass = runManualSync(steps, { isCurrent: () => true });
    await vi.waitFor(() => expect(steps.refresh).toHaveBeenCalledOnce());
    completeLocation();
    await Promise.resolve();
    completeRefresh();
    const result = await pass;
    expect(steps.refresh).toHaveBeenCalledTimes(3); // initial, dirty follow-up, final partial-success refresh
    expect(result.lanes.location.outcome).toBe("partial");
  });
  it("prevents late capture continuation after account replacement", async () => {
    const steps = operations();
    let current = true;
    steps.sleep = async () => {
      current = false;
      return { outcome: "complete" };
    };
    const result = await runManualSync(steps, { isCurrent: () => current });
    expect(steps.healthDelivery).not.toHaveBeenCalled();
    expect(result.lanes.sleep.outcome).toBe("cancelled");
  });
});
