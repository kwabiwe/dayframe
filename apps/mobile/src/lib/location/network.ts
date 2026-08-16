import { mobileFetchWithTimeout } from "../mobile-network";

export const LOCATION_SYNC_REQUEST_TIMEOUT_MS = 15_000;

export async function fetchLocationSync(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  timeoutMilliseconds = LOCATION_SYNC_REQUEST_TIMEOUT_MS
) {
  return mobileFetchWithTimeout(input, init, {
    timeoutMilliseconds,
    timeoutMessage: "Location sync request timed out."
  });
}
