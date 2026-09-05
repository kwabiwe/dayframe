import { invalidateMobileSessionIfCurrent } from "./secure-session";
import {
  connectivityRequestGeneration,
  reportHttpRequestDeadline,
  reportHttpTransportFailure,
  reportHttpTransportResponse
} from "./connectivityEvidence";

export class StaleMobileSessionResponseError extends Error {
  constructor() {
    super("A response from an earlier mobile session was ignored.");
    this.name = "StaleMobileSessionResponseError";
  }
}

export class MobileRequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MobileRequestTimeoutError";
  }
}

export class MobileHttpResponseError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "MobileHttpResponseError";
    this.statusCode = statusCode;
  }
}

type MobileRequestDeadline = {
  timeoutMilliseconds: number;
  timeoutMessage: string;
};

/**
 * Mobile API requests use the SecureStore bearer as their only session carrier.
 *
 * React Native sends shared-cookie credentials by default. Omitting them keeps
 * the visible app and background reconciliation on the same authentication
 * state, so a rejected bearer cannot be hidden by a still-valid web cookie.
 */
export async function mobileFetch(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] = {},
  handleAuthentication = true
) {
  const requestGeneration = connectivityRequestGeneration();
  let response: Response;
  try {
    response = await fetch(input, { ...init, credentials: "omit" });
  } catch (error) {
    if (isMobileTransportFailure(error)) {
      reportHttpTransportFailure({ requestGeneration });
    }
    throw error;
  }
  reportHttpTransportResponse({ requestGeneration });
  const rejectedToken = bearerToken(init.headers);
  if (handleAuthentication && (response.status === 401 || response.status === 403) && rejectedToken) {
    const invalidated = await invalidateMobileSessionIfCurrent(rejectedToken);
    if (!invalidated) throw new StaleMobileSessionResponseError();
  }
  return response;
}

export function isMobileTransportFailure(error: unknown) {
  if (
    !(error instanceof Error) ||
    error instanceof MobileRequestTimeoutError ||
    error instanceof StaleMobileSessionResponseError ||
    error.name === "AbortError"
  ) {
    return false;
  }
  if (error instanceof TypeError) return true;
  return /network connection was lost|network request failed|failed to fetch|networkerror|internet connection/i
    .test(error.message);
}

export function isRetryableMobileConnectivityFailure(error: unknown) {
  return error instanceof MobileRequestTimeoutError ||
    isMobileTransportFailure(error) ||
    (error instanceof MobileHttpResponseError && (
      error.statusCode === 408 ||
      error.statusCode === 429 ||
      error.statusCode >= 500
    ));
}

export async function mobileFetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] = {},
  deadline: MobileRequestDeadline
) {
  return mobileRequestOperation(input, init, deadline, response => Promise.resolve(response));
}

export class InvalidMobileAcknowledgementError extends Error {
  constructor() { super("The server response did not confirm the saved action."); this.name = "InvalidMobileAcknowledgementError"; }
}

/** Own fetch, body parsing, validation and identity checks under one deadline. */
export function mobileJsonRequest<T = Record<string, unknown> | null>(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  options: MobileRequestDeadline & {
    isCurrent?: () => boolean | Promise<boolean>;
    handleAuthentication?: boolean;
    validate?: (body: unknown, response: Response) => T | Promise<T>;
  }
) {
  return mobileRequestOperation(input, init ?? {}, options, async response => {
    let body: unknown;
    try { body = await response.json(); }
    catch { body = null; }
    if (options.isCurrent && !await options.isCurrent()) throw new StaleMobileSessionResponseError();
    const validated = options.validate ? await options.validate(body, response) : body as T;
    return { response, body: validated };
  }, options.isCurrent, true, options.handleAuthentication !== false);
}

async function mobileRequestOperation<T>(
  input: Parameters<typeof fetch>[0], init: RequestInit,
  deadline: MobileRequestDeadline, consume: (response: Response) => Promise<T>,
  isCurrent?: () => boolean | Promise<boolean>, authenticateAfterConsume = false, handleAuthentication = true
) {
  const requestGeneration = connectivityRequestGeneration();
  const controller = new AbortController();
  const callerSignal = init.signal;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectCallerAbort: ((reason?: unknown) => void) | undefined;
  const callerAborted = new Promise<never>((_, reject) => {
    rejectCallerAbort = reject;
  });
  const relayCallerAbort = () => {
    controller.abort();
    rejectCallerAbort?.(callerAbortReason(callerSignal));
  };
  if (callerSignal?.aborted) relayCallerAbort();
  else callerSignal?.addEventListener("abort", relayCallerAbort, { once: true });
  const timeoutReached = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new MobileRequestTimeoutError(deadline.timeoutMessage));
    }, deadline.timeoutMilliseconds);
  });

  try {
    return await Promise.race([
      (async () => {
        if (controller.signal.aborted) throw callerAbortReason(callerSignal);
        if (isCurrent && !await isCurrent()) throw new StaleMobileSessionResponseError();
        if (controller.signal.aborted) throw callerAbortReason(callerSignal);
        const response = await mobileFetch(input, { ...init, signal: controller.signal }, handleAuthentication && !authenticateAfterConsume);
        if (controller.signal.aborted) throw callerAbortReason(callerSignal);
        const result = await consume(response);
        if (controller.signal.aborted) throw callerAbortReason(callerSignal);
        if (isCurrent && !await isCurrent()) throw new StaleMobileSessionResponseError();
        if (handleAuthentication && authenticateAfterConsume && (response.status === 401 || response.status === 403)) {
          const token = bearerToken(init.headers);
          if (token && !await invalidateMobileSessionIfCurrent(token)) throw new StaleMobileSessionResponseError();
        }
        return result;
      })(),
      timeoutReached,
      callerAborted
    ]);
  } catch (error) {
    if (timedOut) reportHttpRequestDeadline({ requestGeneration });
    if (timedOut && !(error instanceof MobileRequestTimeoutError)) {
      throw new MobileRequestTimeoutError(deadline.timeoutMessage);
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", relayCallerAbort);
  }
}

function bearerToken(headers: HeadersInit | undefined) {
  const authorization = new Headers(headers).get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function callerAbortReason(signal: AbortSignal | null | undefined) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("Mobile request was cancelled.");
  error.name = "AbortError";
  return error;
}
