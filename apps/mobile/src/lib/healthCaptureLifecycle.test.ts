import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boundedHealthQuery,
  createHealthCaptureCoalescer,
  HealthQueryDeadlineError
} from "./healthCaptureLifecycle";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
afterEach(() => vi.useRealTimers());
describe("Health capture lifecycle", () => {
  it("settles a hung native query and prevents its late result reaching capture", async () => {
    vi.useFakeTimers();
    const native = deferred<number>();
    const commit = vi.fn();
    const result = boundedHealthQuery(native.promise, Date.now() + 15_000).then(commit);
    const rejected = expect(result).rejects.toBeInstanceOf(HealthQueryDeadlineError);
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    native.resolve(1);
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
  });
  it("ignores a query after cancellation even if native work cannot be cancelled", async () => {
    const native = deferred<number>();
    const controller = new AbortController();
    const commit = vi.fn();
    const result = boundedHealthQuery(native.promise, Date.now() + 15_000, controller.signal).then(
      commit
    );
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    native.resolve(1);
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
  });
  it("coalesces repeated observer updates into a subsequent pass without starving workouts", async () => {
    const runner = createHealthCaptureCoalescer();
    const first = deferred<string>();
    const sleep = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("later");
    const active = runner.run("owner:sleep", sleep);
    const observer = runner.run("owner:sleep", sleep, true);
    runner.run("owner:sleep", sleep, true);
    expect(observer).toBe(active);
    await expect(runner.run("owner:workout", async () => "captured")).resolves.toBe("captured");
    first.resolve("initial");
    await expect(observer).resolves.toBe("later");
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  it("retries a dirty type after a failed capture independently of a hung server reprocess", async () => {
    const runner = createHealthCaptureCoalescer();
    const capture = vi
      .fn()
      .mockRejectedValueOnce(new Error("query fixture"))
      .mockResolvedValue("saved");
    const first = runner.run("owner:sleep", capture);
    runner.run("owner:sleep", capture, true);
    await expect(first).resolves.toBe("saved");
    expect(capture).toHaveBeenCalledTimes(2);
  });
});
