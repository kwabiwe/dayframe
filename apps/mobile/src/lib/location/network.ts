export const LOCATION_SYNC_REQUEST_TIMEOUT_MS = 15_000;

export async function fetchLocationSync(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  timeoutMilliseconds = LOCATION_SYNC_REQUEST_TIMEOUT_MS
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("Location sync request timed out."));
      controller.abort();
    }, timeoutMilliseconds);
  });

  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      timedOut
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
