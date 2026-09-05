import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./secure-session", () => ({ invalidateMobileSessionIfCurrent: vi.fn() }));
const evidence = vi.hoisted(() => ({
  connectivityRequestGeneration: () => 1,
  reportHttpRequestDeadline: vi.fn(),
  reportHttpTransportFailure: vi.fn(),
  reportHttpTransportResponse: vi.fn()
}));
vi.mock("./connectivityEvidence", () => evidence);
import {
  mobileJsonRequest,
  MobileRequestTimeoutError,
  StaleMobileSessionResponseError
} from "./mobile-network";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("complete sync JSON deadlines", () => {
  it("aborts a stalled body after headers arrive and ignores its late acknowledgement", async () => {
    vi.useFakeTimers();
    let body!: (value: unknown) => void;
    let signal!: AbortSignal;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => {
        signal = init.signal;
        return Promise.resolve({
          status: 200,
          json: () =>
            new Promise((resolve) => {
              body = resolve;
            })
        });
      })
    );
    const operation = mobileJsonRequest(
      "https://fixture.invalid",
      {},
      { timeoutMilliseconds: 100, timeoutMessage: "deadline" }
    );
    const rejected = expect(operation).rejects.toBeInstanceOf(MobileRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    expect(signal.aborted).toBe(true);
    body({ eventId: "late" });
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds validation and rejects an owner changed while parsing", async () => {
    let current = true;
    let finish!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        json: () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      }))
    );
    const result = mobileJsonRequest(
      "https://fixture.invalid",
      {},
      { timeoutMilliseconds: 1000, timeoutMessage: "deadline", isCurrent: () => current }
    );
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    current = false;
    finish({ eventId: "old-owner" });
    await expect(result).rejects.toBeInstanceOf(StaleMobileSessionResponseError);
  });
  it("does not dispatch a stale or already cancelled operation", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(
      mobileJsonRequest(
        "https://fixture.invalid",
        { signal: controller.signal },
        { timeoutMilliseconds: 100, timeoutMessage: "deadline" }
      )
    ).rejects.toThrow();
    await expect(
      mobileJsonRequest(
        "https://fixture.invalid",
        {},
        { timeoutMilliseconds: 100, timeoutMessage: "deadline", isCurrent: () => false }
      )
    ).rejects.toBeInstanceOf(StaleMobileSessionResponseError);
    expect(fetch).not.toHaveBeenCalled();
    expect(evidence.reportHttpTransportFailure).not.toHaveBeenCalled();
  });
  it("keeps the deadline until asynchronous validation settles", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 200, json: async () => ({}) }))
    );
    const result = mobileJsonRequest(
      "https://fixture.invalid",
      {},
      {
        timeoutMilliseconds: 100,
        timeoutMessage: "deadline",
        validate: () => new Promise(() => {})
      }
    );
    const rejected = expect(result).rejects.toBeInstanceOf(MobileRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
  });
});
