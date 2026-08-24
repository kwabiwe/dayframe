import { describe, expect, it, vi } from "vitest";
import {
  TimerBackgroundExecutionCancelledError,
  TimerBackgroundExecutionExpiredError,
  createTimerBackgroundExecutionManager,
  type TimerBackgroundExecutionNativeAdapter
} from "./timerBackgroundExecution";

function fakeNative() {
  let expirationListener: ((event: {
    generation: number;
    leaseTokens: string[];
    reason: "expired";
  }) => void) | null = null;
  let sequence = 0;
  const adapter: TimerBackgroundExecutionNativeAdapter = {
    addExpirationListener: vi.fn((listener) => {
      expirationListener = listener;
      return { remove: vi.fn() };
    }),
    begin: vi.fn(async () => `native-${++sequence}`),
    end: vi.fn(async () => true),
    endAll: vi.fn(async () => 0)
  };
  return {
    adapter,
    expire(...leaseTokens: string[]) {
      expirationListener?.({ generation: 1, leaseTokens, reason: "expired" });
    }
  };
}

describe("timer background execution manager", () => {
  it("tracks overlapping leases and finishes each native lease exactly once", async () => {
    const native = fakeNative();
    const manager = createTimerBackgroundExecutionManager(native.adapter);
    const first = await manager.begin("Timer Start");
    const second = await manager.begin("Timer Stop");

    expect(manager.snapshot().activeLeaseCount).toBe(2);
    await first.end("success");
    await first.end("failure");
    expect(native.adapter.end).toHaveBeenCalledTimes(1);
    expect(manager.snapshot().activeLeaseCount).toBe(1);

    await second.end("failure");
    expect(native.adapter.end).toHaveBeenCalledTimes(2);
    expect(manager.snapshot().activeLeaseCount).toBe(0);
  });

  it("lets native expiry abort every affected operation without ending it again from JS", async () => {
    const native = fakeNative();
    const manager = createTimerBackgroundExecutionManager(native.adapter);
    const first = await manager.begin("Timer Start");
    const second = await manager.begin("Timer Edit");

    native.expire("native-1", "native-2");

    expect(first.signal.aborted).toBe(true);
    expect(first.signal.reason).toBeInstanceOf(TimerBackgroundExecutionExpiredError);
    expect(second.signal.aborted).toBe(true);
    expect(manager.snapshot().activeLeaseCount).toBe(0);
    await first.end("cancelled");
    await second.end("cancelled");
    expect(native.adapter.end).not.toHaveBeenCalled();
  });

  it("cancels every lease at logout and asks native to consume the task once", async () => {
    const native = fakeNative();
    const manager = createTimerBackgroundExecutionManager(native.adapter);
    const first = await manager.begin("Timer Start");
    const second = await manager.begin("Timer Stop");

    await manager.endAll("logout");

    expect(first.signal.reason).toBeInstanceOf(TimerBackgroundExecutionCancelledError);
    expect(second.signal.reason).toBeInstanceOf(TimerBackgroundExecutionCancelledError);
    expect(native.adapter.endAll).toHaveBeenCalledOnce();
    expect(native.adapter.end).not.toHaveBeenCalled();
    expect(manager.snapshot().activeLeaseCount).toBe(0);
  });

  it.each(["account_changed", "cancelled"] as const)(
    "ends all leases exactly once for %s",
    async (reason) => {
      const native = fakeNative();
      const manager = createTimerBackgroundExecutionManager(native.adapter);
      const lease = await manager.begin("Timer Start");

      await manager.endAll(reason);
      await manager.endAll(reason);
      await lease.end("success");

      expect(lease.signal.reason).toBeInstanceOf(TimerBackgroundExecutionCancelledError);
      expect(native.adapter.endAll).toHaveBeenCalledTimes(2);
      expect(native.adapter.end).not.toHaveBeenCalled();
      expect(manager.snapshot().activeLeaseCount).toBe(0);
    }
  );

  it("ends active leases and removes the native expiration listener on teardown", async () => {
    const native = fakeNative();
    const manager = createTimerBackgroundExecutionManager(native.adapter);
    const lease = await manager.begin("Timer Delete");
    const subscription = vi.mocked(native.adapter.addExpirationListener).mock.results[0]?.value;

    await manager.dispose();

    expect(lease.signal.reason).toBeInstanceOf(TimerBackgroundExecutionCancelledError);
    expect(subscription?.remove).toHaveBeenCalledOnce();
    expect(native.adapter.endAll).toHaveBeenCalledWith("teardown");
  });

  it("does not resurrect a lease when logout races a pending native begin", async () => {
    const native = fakeNative();
    let resolveBegin!: (token: string) => void;
    vi.mocked(native.adapter.begin).mockImplementationOnce(() =>
      new Promise<string>((resolve) => {
        resolveBegin = resolve;
      })
    );
    const manager = createTimerBackgroundExecutionManager(native.adapter);
    const pendingLease = manager.begin("Timer Start");
    expect(manager.snapshot().activeLeaseCount).toBe(1);

    const logout = manager.endAll("logout");
    resolveBegin("native-raced");
    const lease = await pendingLease;
    await logout;

    expect(lease.signal.aborted).toBe(true);
    expect(manager.snapshot().activeLeaseCount).toBe(0);
    expect(native.adapter.endAll).toHaveBeenCalledOnce();
    expect(native.adapter.end).toHaveBeenCalledOnce();
    expect(native.adapter.end).toHaveBeenCalledWith("native-raced", "cancelled");
  });

  it("keeps the operation usable when UIKit declines a background identifier", async () => {
    const native = fakeNative();
    vi.mocked(native.adapter.begin).mockResolvedValueOnce(null);
    const manager = createTimerBackgroundExecutionManager(native.adapter);
    const lease = await manager.begin("Timer Start");

    expect(lease.signal.aborted).toBe(false);
    expect(manager.snapshot().activeLeaseCount).toBe(1);
    await lease.end("success");
    expect(native.adapter.end).not.toHaveBeenCalled();
    expect(manager.snapshot().activeLeaseCount).toBe(0);
  });

  it("publishes only real lifecycle transitions", async () => {
    const native = fakeNative();
    const manager = createTimerBackgroundExecutionManager(native.adapter);
    const listener = vi.fn();
    manager.subscribe(listener);
    const lease = await manager.begin("Timer Delete");
    await lease.end("success");
    await lease.end("success");

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("lets foreground-only work wait until every timer lease settles", async () => {
    const native = fakeNative();
    const manager = createTimerBackgroundExecutionManager(native.adapter);
    const first = await manager.begin("Timer Start");
    const second = await manager.begin("Timer Stop");
    let settled = false;
    const wait = manager.waitUntilIdle().then(() => {
      settled = true;
    });

    await first.end("success");
    await Promise.resolve();
    expect(settled).toBe(false);
    await second.end("success");
    await wait;
    expect(settled).toBe(true);
  });
});
