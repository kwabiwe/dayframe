export class HealthQueryDeadlineError extends Error {
  constructor() {
    super("Apple Health query timed out. Its saved checkpoint is unchanged.");
    this.name = "HealthQueryDeadlineError";
  }
}

/** The installed native library cannot cancel a query. Settle the caller and ignore late data. */
export function boundedHealthQuery<T>(
  query: Promise<T>,
  deadlineAt: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (work: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      work();
    };
    const abort = () =>
      finish(() =>
        reject(
          Object.assign(new Error("Health capture cancelled."), {
            name: "AbortError",
          }),
        ),
      );
    const timer = setTimeout(
      () => finish(() => reject(new HealthQueryDeadlineError())),
      Math.max(0, deadlineAt - Date.now()),
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    query.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

/** Per-type observer changes are consumed after the current capture, independently of server work. */
export function createHealthCaptureCoalescer() {
  const active = new Map<
    string,
    { promise: Promise<unknown>; dirty: boolean }
  >();
  const runner = {
    run<T>(
      key: string,
      capture: () => Promise<T>,
      markDirty = false,
    ): Promise<T> {
      const current = active.get(key);
      if (current) {
        if (markDirty) current.dirty = true;
        return current.promise as Promise<T>;
      }
      const entry = {
        promise: Promise.resolve<unknown>(undefined),
        dirty: false,
      };
      entry.promise = (async () => {
        let value: T | undefined;
        let failure: unknown;
        // A caller owns at most the active pass and one observer follow-up.
        // Changes during that follow-up start a separate cycle after this promise settles.
        for (let pass = 0; pass < 2; pass++) {
          entry.dirty = false;
          try {
            value = await capture();
            failure = undefined;
          } catch (error) {
            failure = error;
          }
          if (!entry.dirty) break;
        }
        if (failure) throw failure;
        return value as T;
      })().finally(() => {
        if (active.get(key) === entry) {
          active.delete(key);
          if (entry.dirty) {
            setTimeout(() => {
              void runner.run(key, capture, true).catch(() => undefined);
            }, 0);
          }
        }
      });
      active.set(key, entry);
      return entry.promise as Promise<T>;
    },
  };
  return runner;
}
