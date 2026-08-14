import { invalidateMobileSessionIfCurrent } from "./secure-session";

export class StaleMobileSessionResponseError extends Error {
  constructor() {
    super("A response from an earlier mobile session was ignored.");
    this.name = "StaleMobileSessionResponseError";
  }
}

/**
 * Mobile API requests use the SecureStore bearer as their only session carrier.
 *
 * React Native sends shared-cookie credentials by default. Omitting them keeps
 * the visible app and background reconciliation on the same authentication
 * state, so a rejected bearer cannot be hidden by a still-valid web cookie.
 */
export async function mobileFetch(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] = {}
) {
  const response = await fetch(input, { ...init, credentials: "omit" });
  const rejectedToken = bearerToken(init.headers);
  if ((response.status === 401 || response.status === 403) && rejectedToken) {
    const invalidated = await invalidateMobileSessionIfCurrent(rejectedToken);
    if (!invalidated) throw new StaleMobileSessionResponseError();
  }
  return response;
}

function bearerToken(headers: HeadersInit | undefined) {
  const authorization = new Headers(headers).get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
