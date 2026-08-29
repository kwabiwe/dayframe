import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  callbacks: [] as Array<() => void | Promise<void>>,
  afterError: undefined as Error | undefined,
  notifyLiveActivitiesBestEffort: vi.fn(),
  retryLiveActivityDeliveryBestEffort: vi.fn()
}));

vi.mock("next/server", () => ({
  after: (callback: () => void | Promise<void>) => {
    if (mocks.afterError) throw mocks.afterError;
    mocks.callbacks.push(callback);
  }
}));

vi.mock("./live-activity-push", () => ({
  notifyLiveActivitiesBestEffort: mocks.notifyLiveActivitiesBestEffort,
  retryLiveActivityDeliveryBestEffort: mocks.retryLiveActivityDeliveryBestEffort
}));

const {
  scheduleLiveActivityNotification,
  scheduleLiveActivityRetry
} = await import("./live-activity-post-response");

describe("Live Activity post-response scheduling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.callbacks.length = 0;
    mocks.afterError = undefined;
  });

  it("returns before delayed mutation delivery begins", async () => {
    let finishDelivery: (() => void) | undefined;
    mocks.notifyLiveActivitiesBestEffort.mockImplementation(() => new Promise<void>((resolve) => {
      finishDelivery = resolve;
    }));

    scheduleLiveActivityNotification(session);

    expect(mocks.callbacks).toHaveLength(1);
    expect(mocks.notifyLiveActivitiesBestEffort).not.toHaveBeenCalled();

    const delivery = Promise.resolve(mocks.callbacks[0]());
    expect(mocks.notifyLiveActivitiesBestEffort).toHaveBeenCalledWith(session);
    let settled = false;
    void delivery.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    finishDelivery?.();
    await expect(delivery).resolves.toBeUndefined();
  });

  it("contains an unexpected push failure inside the post-response task", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.notifyLiveActivitiesBestEffort.mockRejectedValueOnce(new Error("APNs unavailable"));

    scheduleLiveActivityNotification(session);
    await expect(Promise.resolve(mocks.callbacks[0]())).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(
      "Dayframe Live Activity post-response task failed",
      { source: "mutation", name: "Error" }
    );
    log.mockRestore();
  });

  it("also defers desired-state reconstruction from bootstrap reads", async () => {
    mocks.retryLiveActivityDeliveryBestEffort.mockResolvedValueOnce(undefined);

    scheduleLiveActivityRetry(session);
    expect(mocks.retryLiveActivityDeliveryBestEffort).not.toHaveBeenCalled();
    await expect(Promise.resolve(mocks.callbacks[0]())).resolves.toBeUndefined();
    expect(mocks.retryLiveActivityDeliveryBestEffort).toHaveBeenCalledWith(session);
  });

  it("cannot turn a scheduler failure into a committed timer failure", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.afterError = new Error("request lifecycle unavailable");

    expect(() => scheduleLiveActivityNotification(session)).not.toThrow();
    expect(log).toHaveBeenCalledWith(
      "Dayframe Live Activity post-response task failed",
      { source: "mutation", name: "Error" }
    );
    log.mockRestore();
  });
});
