import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestDeadlineError, withRequestDeadline } from "./request-deadline";

afterEach(() => {
  vi.useRealTimers();
});

describe("withRequestDeadline (stability audit WEB-UI-11)", () => {
  it("rejects a request that never answers and aborts its signal", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null = null;
    const pending = withRequestDeadline((given) => {
      signal = given;
      return new Promise<never>(() => undefined);
    }, 1_000);
    const settled = expect(pending).rejects.toBeInstanceOf(RequestDeadlineError);
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
    expect(signal!.aborted).toBe(true);
  });

  it("passes through an answer or an error that comes in time, and clears its timer", async () => {
    vi.useFakeTimers();
    await expect(withRequestDeadline(async () => "ok", 1_000)).resolves.toBe("ok");
    await expect(withRequestDeadline(async () => { throw new Error("refused"); }, 1_000)).rejects.toThrow("refused");
    expect(vi.getTimerCount()).toBe(0);
  });
});
