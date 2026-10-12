import { describe, expect, it, vi } from "vitest";

vi.mock("./secure-session", () => ({ invalidateMobileSessionIfCurrent: vi.fn() }));
vi.mock("./connectivityEvidence", () => ({
  connectivityRequestGeneration: vi.fn(() => 1),
  reportHttpRequestDeadline: vi.fn(),
  reportHttpTransportFailure: vi.fn(),
  reportHttpTransportResponse: vi.fn()
}));

const { MobileApiResponseError, MobileHttpResponseError, MobileRequestTimeoutError } = await import("./mobile-network");
const {
  friendlyMobileErrorMessage,
  mobileFailureKind,
  OFFLINE_ACTION_MESSAGE,
  serverErrorSentence,
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
    expect(friendlyMobileErrorMessage(new MobileApiResponseError(500, "relation \"places\" does not exist", true), "fallback")).toBe("fallback");
  });

  it("keeps our API's validation sentence however long it is", () => {
    const long = `Place name is required. ${"Choose a shorter radius or move the pin so this place does not overlap another saved place. ".repeat(3)}`.trim();
    expect(long.length).toBeGreaterThan(160);
    expect(friendlyMobileErrorMessage(new MobileApiResponseError(400, long, true), "fallback")).toBe(long);
    expect(friendlyMobileErrorMessage(new MobileApiResponseError(409, "That place already exists.", true), "fallback")).toBe(
      "That place already exists."
    );
    expect(serverErrorSentence(new MobileApiResponseError(422, "  ", true))).toBeNull();
  });

  it("uses the fallback for a reply whose words were not the server's own", () => {
    // A non-JSON body or an empty one: the message is this app's "<fallback>: 400", not the server's.
    expect(friendlyMobileErrorMessage(new MobileApiResponseError(400, "Unable to update place: 400", false), "Couldn't update this place.")).toBe(
      "Couldn't update this place."
    );
  });

  it("never shows a short native rejection chain", () => {
    const chain = new Error("Call to function 'ExpoSQLite.execAsync' has been rejected.\n→ Caused by: database is locked");
    expect(friendlyMobileErrorMessage(chain, "Couldn’t save this Review choice on this iPhone.")).toBe(
      "Couldn’t save this Review choice on this iPhone."
    );
    expect(friendlyMobileErrorMessage(new Error("database is locked"), "fallback")).toBe("fallback");
  });

  it("never shows JS stack text", () => {
    const stack = new Error("undefined is not a function\n    at resolveItem (index.bundle:1234:56)");
    expect(friendlyMobileErrorMessage(stack, "fallback")).toBe("fallback");
    expect(friendlyMobileErrorMessage(new TypeError("Cannot read property 'id' of undefined"), "fallback")).not.toContain("Cannot read");
    expect(friendlyMobileErrorMessage("not an error", "fallback")).toBe("fallback");
  });

  it("does not call a cancelled request offline, nor a server reply about the internet", () => {
    const aborted = new Error("The internet connection appears to be offline.");
    aborted.name = "AbortError";
    expect(mobileFailureKind(aborted)).toBe("other");
    expect(mobileFailureKind(new MobileApiResponseError(400, "Not connected to the internet calendar.", true))).toBe("other");
  });
});
