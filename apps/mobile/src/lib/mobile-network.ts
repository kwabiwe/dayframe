/**
 * Mobile API requests use the SecureStore bearer as their only session carrier.
 *
 * React Native sends shared-cookie credentials by default. Omitting them keeps
 * the visible app and background reconciliation on the same authentication
 * state, so a rejected bearer cannot be hidden by a still-valid web cookie.
 */
export function mobileFetch(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] = {}
) {
  return fetch(input, { ...init, credentials: "omit" });
}
