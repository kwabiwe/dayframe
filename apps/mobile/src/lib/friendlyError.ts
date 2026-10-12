import {
  isMobileTransportFailure,
  isRetryableMobileConnectivityFailure,
  MobileApiResponseError,
  MobileRequestTimeoutError
} from "./mobile-network";

/**
 * Plain words for a failed request on iPhone (staging feedback B2). What is shown is decided by
 * where the error came from, not by how it reads: only a sentence from our own API's error body
 * (`MobileApiResponseError` with `fromServerBody`, a 4xx such as "Place name is required", however
 * long) is shown as it is. Everything else (a native rejection such as "fetch failed:
 * UnexpectedException: … Promise.swift:56" or "… Caused by: database is locked", a JS stack, a
 * local store error, a 5xx) is the screen's own fallback, or the offline / slow line below.
 */
export const OFFLINE_ACTION_MESSAGE = "You're offline. Try again when you're connected.";
export const SLOW_CONNECTION_MESSAGE = "The connection is too slow right now. Try again in a moment.";

export type MobileFailureKind = "offline" | "slow" | "unavailable" | "other";

/** iOS words for "no route to the server" that do not always reach the transport check. */
const NATIVE_OFFLINE_PATTERN =
  /internet connection appears to be offline|not connected to the internet|could not connect to the server|hostname could not be found|network connection was lost/i;

export function mobileFailureKind(error: unknown): MobileFailureKind {
  // Our server answered, so the connection worked whatever its words say.
  if (error instanceof MobileApiResponseError) return error.statusCode >= 500 ? "unavailable" : "other";
  if (isMobileTransportFailure(error)) return "offline";
  if (error instanceof Error && error.name !== "AbortError" && NATIVE_OFFLINE_PATTERN.test(error.message)) return "offline";
  if (error instanceof MobileRequestTimeoutError) return "slow";
  if (isRetryableMobileConnectivityFailure(error)) return "unavailable";
  return "other";
}

/** A sentence our own API wrote for people (a 4xx error body), safe to show as it is. */
export function serverErrorSentence(error: unknown) {
  if (!(error instanceof MobileApiResponseError) || !error.fromServerBody) return null;
  if (error.statusCode < 400 || error.statusCode >= 500) return null;
  return error.message.trim() || null;
}

/**
 * The one line an Alert, status line or sheet shows after an action the person asked for failed.
 * `fallback` is the screen's own sentence ("Couldn't save this place. Try again.").
 */
export function friendlyMobileErrorMessage(error: unknown, fallback: string) {
  switch (mobileFailureKind(error)) {
    case "offline":
      return OFFLINE_ACTION_MESSAGE;
    case "slow":
      return SLOW_CONNECTION_MESSAGE;
    default:
      return serverErrorSentence(error) ?? fallback;
  }
}
