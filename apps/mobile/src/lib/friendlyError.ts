import {
  isMobileTransportFailure,
  isRetryableMobileConnectivityFailure,
  MobileRequestTimeoutError
} from "./mobile-network";

/**
 * Plain words for a failed request on iPhone (staging feedback B2). A native or transport error
 * ("fetch failed: UnexpectedException: The Internet connection appears to be offline. (at
 * ExpoModulesCore/Promise.swift:56)") is never shown as it is: an offline failure says so in one
 * line, a slow or busy server gets the caller's own fallback, and only a short, readable server
 * message (e.g. "Place name is required") is kept.
 */
export const OFFLINE_ACTION_MESSAGE = "You're offline. Try again when you're connected.";
export const SLOW_CONNECTION_MESSAGE = "The connection is too slow right now. Try again in a moment.";

export type MobileFailureKind = "offline" | "slow" | "unavailable" | "other";

/** iOS words for "no route to the server" that do not always reach the transport check. */
const NATIVE_OFFLINE_PATTERN =
  /internet connection appears to be offline|not connected to the internet|could not connect to the server|hostname could not be found|network connection was lost/i;

/** Text that is a native exception, a stack position or a parser complaint, never a sentence for people. */
const RAW_ERROR_PATTERN =
  /ExpoModulesCore|UnexpectedException|Exception:|\.swift:\d+|\.mm?:\d+|Error Domain=|NSURLErrorDomain|NSCocoaErrorDomain|^fetch failed|JSON Parse error|Unexpected token|is not a function|undefined is not|null is not|Cannot read propert|TypeError|SyntaxError|SQLITE_|\(at [^)]*:\d+\)/i;

const READABLE_MESSAGE_LIMIT = 160;

export function mobileFailureKind(error: unknown): MobileFailureKind {
  if (isMobileTransportFailure(error)) return "offline";
  if (error instanceof Error && error.name !== "AbortError" && NATIVE_OFFLINE_PATTERN.test(error.message)) return "offline";
  if (error instanceof MobileRequestTimeoutError) return "slow";
  if (isRetryableMobileConnectivityFailure(error)) return "unavailable";
  return "other";
}

/** A message short and plain enough to show as it is. */
export function isReadableErrorMessage(message: string) {
  const trimmed = message.trim();
  return trimmed.length > 0 && trimmed.length <= READABLE_MESSAGE_LIMIT && !RAW_ERROR_PATTERN.test(trimmed);
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
    case "unavailable":
      return fallback;
    default:
      return error instanceof Error && isReadableErrorMessage(error.message) ? error.message.trim() : fallback;
  }
}
