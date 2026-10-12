import { describe, expect, it, vi } from "vitest";

vi.mock("./secure-session", () => ({ invalidateMobileSessionIfCurrent: vi.fn() }));
vi.mock("./connectivityEvidence", () => ({
  connectivityRequestGeneration: vi.fn(() => 1),
  reportHttpRequestDeadline: vi.fn(),
  reportHttpTransportFailure: vi.fn(),
  reportHttpTransportResponse: vi.fn()
}));

const { MobileHttpResponseError, MobileRequestTimeoutError } = await import("./mobile-network");
const {
  friendlyMobileErrorMessage,
  isReadableErrorMessage,
  mobileFailureKind,
  OFFLINE_ACTION_MESSAGE,
  SLOW_CONNECTION_MESSAGE
} = await import("./friendlyError");

const NATIVE_OFFLINE =
  "fetch failed: UnexpectedException: The Internet connection appears to be offline. (at ExpoModulesCore/Promise.swift:56)";

describe("friendly mobile error messages (staging feedback B2)", () => {
  it("never shows the native offline exception from Saved places", () => {
    const error = new Error(NATIVE_OFFLINE);
    expect(mobileFailureKind(error)).toBe("offline");
    expect(friendlyMobileErrorMessage(error, "Couldn't load your places. Try again.")).toBe(OFFLINE_ACTION_MESSAGE);
    expect(OFFLINE_ACTION_MESSAGE).toBe("You're offline. Try again when you're connected.");
  });

  it("treats transport failures and iOS no-route words as offline", () => {
    expect(mobileFailureKind(new TypeError("Network request failed"))).toBe("offline");
    expect(mobileFailureKind(new Error("fetch failed: A server with the specified hostname could not be found."))).toBe("offline");
    expect(mobileFailureKind(new Error("The network connection was lost."))).toBe("offline");
  });

  it("says a slow connection for a deadline and uses the fallback for a busy server", () => {
    expect(friendlyMobileErrorMessage(new MobileRequestTimeoutError("Dayframe is taking too long"), "x")).toBe(SLOW_CONNECTION_MESSAGE);
    expect(friendlyMobileErrorMessage(new MobileHttpResponseError(503, "Unable to load Dayframe API"), "Couldn't save. Try again.")).toBe(
      "Couldn't save. Try again."
    );
  });

  it("keeps a short readable server message and drops raw or long text", () => {
    expect(friendlyMobileErrorMessage(new Error("Place name is required."), "fallback")).toBe("Place name is required.");
    expect(friendlyMobileErrorMessage(new Error("fetch failed: UnexpectedException: boom"), "fallback")).toBe("fallback");
    expect(friendlyMobileErrorMessage(new Error("undefined is not an object (evaluating 'a.b')"), "fallback")).toBe("fallback");
    expect(friendlyMobileErrorMessage(new Error("x".repeat(200)), "fallback")).toBe("fallback");
    expect(friendlyMobileErrorMessage("not an error", "fallback")).toBe("fallback");
    expect(isReadableErrorMessage("   ")).toBe(false);
  });

  it("does not call a cancelled request offline", () => {
    const aborted = new Error("The internet connection appears to be offline.");
    aborted.name = "AbortError";
    expect(mobileFailureKind(aborted)).toBe("other");
  });
});
