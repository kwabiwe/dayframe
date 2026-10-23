// A client deadline for the web timer's Start and details requests (stability audit WEB-UI-11): a
// request with no answer by then settles as failed through its caller's ordinary error path, so a
// Stop waiting behind it goes ahead. The request is also aborted, but the server may still have
// committed it: callers reconcile from the server (a forced bootstrap refresh, a 409's copy).

export const TIMER_REQUEST_DEADLINE_MS = 15_000;

export class RequestDeadlineError extends Error {
  constructor() {
    super("The server took too long to answer. Check your connection and try again.");
    this.name = "RequestDeadlineError";
  }
}

let deadlineMs = TIMER_REQUEST_DEADLINE_MS;

/** Tests only: a shorter deadline (none given: the default again). */
export function setTimerRequestDeadlineForTests(ms?: number) {
  deadlineMs = ms ?? TIMER_REQUEST_DEADLINE_MS;
}

/** Runs `request` with an abort signal; rejects with `RequestDeadlineError` once the deadline passes. */
export async function withRequestDeadline<T>(request: (signal: AbortSignal) => Promise<T>, ms = deadlineMs): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new RequestDeadlineError();
      controller.abort(error);
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([request(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
