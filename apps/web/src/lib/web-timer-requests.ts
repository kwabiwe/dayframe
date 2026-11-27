const TIMER_WRITE_ATTEMPT_LIMIT_MS = 10_000;

export async function runRequestWithDeadline<T>(send: (signal: AbortSignal) => Promise<T>, limitMs: number) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), limitMs);
  try {
    return await send(controller.signal);
  } finally {
    clearTimeout(deadline);
  }
}

/** Each attempt sends the same command. A lost reply can follow a commit. */
export async function deliverWebTimerWrite<T>(send: (signal: AbortSignal) => Promise<T | null>, sameOwner: () => boolean) {
  const sendAttempt = () => runRequestWithDeadline(send, TIMER_WRITE_ATTEMPT_LIMIT_MS).catch(() => null);
  if (!sameOwner()) return null;
  const first = await sendAttempt();
  return first ?? (sameOwner() ? sendAttempt() : null);
}
