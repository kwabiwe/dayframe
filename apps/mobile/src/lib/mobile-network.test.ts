import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  invalidateMobileSessionIfCurrent: vi.fn(() => Promise.resolve(true))
}));
const connectivity = vi.hoisted(() => ({
  connectivityRequestGeneration: vi.fn(() => 7),
  reportHttpRequestDeadline: vi.fn(),
  reportHttpTransportFailure: vi.fn(),
  reportHttpTransportResponse: vi.fn()
}));

vi.mock("./secure-session", () => ({
  invalidateMobileSessionIfCurrent: session.invalidateMobileSessionIfCurrent
}));
vi.mock("./connectivityEvidence", () => connectivity);

const {
  MobileRequestTimeoutError,
  isMobileTransportFailure,
  mobileFetch,
  mobileFetchWithTimeout,
  StaleMobileSessionResponseError
} = await import("./mobile-network");

describe("mobile API network boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    session.invalidateMobileSessionIfCurrent.mockResolvedValue(true);
  });

  it("omits shared cookies even when a caller requests credentials", async () => {
    const response = { ok: true } as Response;
    const fetchMock = vi.fn(() => Promise.resolve(response));
    vi.stubGlobal("fetch", fetchMock);

    await expect(mobileFetch("https://dayframe.test/api/bootstrap", {
      headers: { Authorization: "Bearer session-token" },
      credentials: "include"
    })).resolves.toBe(response);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/bootstrap",
      {
        headers: { Authorization: "Bearer session-token" },
        credentials: "omit"
      }
    );
    expect(connectivity.reportHttpTransportResponse).toHaveBeenCalledWith({
      requestGeneration: 7
    });
  });

  it("reports every HTTP status as transport evidence", async () => {
    const response = { ok: false, status: 500 } as Response;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response)));

    await expect(mobileFetch("https://dayframe.test/api/bootstrap")).resolves.toBe(response);

    expect(connectivity.reportHttpTransportResponse).toHaveBeenCalledWith({
      requestGeneration: 7
    });
    expect(connectivity.reportHttpTransportFailure).not.toHaveBeenCalled();
  });

  it("invalidates only the bearer rejected by an authentication response", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 401 } as Response)));

    await mobileFetch("https://dayframe.test/api/bootstrap", {
      headers: { Authorization: "Bearer rejected-token" }
    });

    expect(session.invalidateMobileSessionIfCurrent).toHaveBeenCalledWith("rejected-token");
  });

  it("rejects a stale authentication response without invalidating a replacement login", async () => {
    session.invalidateMobileSessionIfCurrent.mockResolvedValueOnce(false);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 401 } as Response)));

    await expect(mobileFetch("https://dayframe.test/api/bootstrap", {
      headers: { Authorization: "Bearer old-token" }
    })).rejects.toBeInstanceOf(StaleMobileSessionResponseError);
    expect(connectivity.reportHttpTransportResponse).toHaveBeenCalledWith({
      requestGeneration: 7
    });
  });

  it("refreshes reachability for fetch transport failures and rethrows unchanged", async () => {
    const failure = new TypeError("Network request failed");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(failure)));

    await expect(mobileFetch("https://dayframe.test/api/bootstrap")).rejects.toBe(failure);
    expect(connectivity.reportHttpTransportFailure).toHaveBeenCalledWith({
      requestGeneration: 7
    });
  });

  it("recognises a native connection-lost error as transport failure", () => {
    expect(isMobileTransportFailure(new Error("The network connection was lost."))).toBe(true);
  });

  it("does not classify caller cancellation or deadline errors as transport failure", () => {
    const cancellation = new Error("Cancelled by caller.");
    cancellation.name = "AbortError";
    expect(isMobileTransportFailure(cancellation)).toBe(false);
    expect(isMobileTransportFailure(
      new MobileRequestTimeoutError("Dayframe opening timed out.")
    )).toBe(false);
  });

  it("aborts and rejects a stalled request at its deadline", async () => {
    vi.useFakeTimers();
    const requestSignals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_input, init: RequestInit | undefined) => {
      requestSignals.push(init?.signal as AbortSignal);
      return new Promise<Response>(() => undefined);
    }));

    const request = mobileFetchWithTimeout(
      "https://dayframe.test/api/bootstrap",
      {},
      { timeoutMilliseconds: 100, timeoutMessage: "Dayframe opening timed out." }
    );
    const rejection = expect(request).rejects.toBeInstanceOf(MobileRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(100);

    await rejection;
    expect(requestSignals[0]?.aborted).toBe(true);
    expect(connectivity.reportHttpRequestDeadline).toHaveBeenCalledWith({
      requestGeneration: 7
    });
    expect(connectivity.reportHttpTransportFailure).not.toHaveBeenCalled();
  });

  it("preserves caller cancellation instead of reporting it as a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const controller = new AbortController();
    const cancellation = new Error("Cancelled by caller.");

    const request = mobileFetchWithTimeout(
      "https://dayframe.test/api/bootstrap",
      { signal: controller.signal },
      { timeoutMilliseconds: 100, timeoutMessage: "Dayframe opening timed out." }
    );
    controller.abort(cancellation);

    await expect(request).rejects.toBe(cancellation);
    expect(connectivity.reportHttpRequestDeadline).not.toHaveBeenCalled();
    expect(connectivity.reportHttpTransportFailure).not.toHaveBeenCalled();
  });

  it("clears the request deadline after a successful response", async () => {
    vi.useFakeTimers();
    const response = { ok: true, status: 200 } as Response;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response)));

    await expect(mobileFetchWithTimeout(
      "https://dayframe.test/api/bootstrap",
      {},
      { timeoutMilliseconds: 100, timeoutMessage: "Dayframe opening timed out." }
    )).resolves.toBe(response);

    expect(vi.getTimerCount()).toBe(0);
  });
});
