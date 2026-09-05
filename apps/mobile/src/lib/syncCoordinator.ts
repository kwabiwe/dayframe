import { createOwnerSyncCoalescer } from "./ownerSyncCoalescer";
import type { SyncLaneOutcome } from "./syncLane";

export type ManualSyncLane = "sleep" | "workouts" | "activity" | "review" | "location" | "refresh";
export type ManualLaneResult = {
  outcome: SyncLaneOutcome;
  changed?: boolean;
  stage?: string;
  remainingCount?: number;
};
export type ManualSyncContext = {
  signal: AbortSignal;
  deadlineAt: number;
  isCurrent: () => boolean | Promise<boolean>;
};
export type ManualSyncResult = {
  startedAt: string;
  finishedAt: string;
  lanes: Record<ManualSyncLane, ManualLaneResult>;
};
type Operation = (context: ManualSyncContext) => Promise<ManualLaneResult>;
export type ManualSyncOperations = {
  sleep: Operation;
  workouts: Operation;
  activity: Operation;
  review: Operation;
  location: Operation;
  healthDelivery: Operation;
  healthReprocess: Operation;
  refresh: Operation;
  classifyError: (error: unknown) => SyncLaneOutcome;
};

/** The deadline releases the UI; every underlying operation retains its own abort/owner guard. */
export async function runManualSync(
  operations: ManualSyncOperations,
  options: { isCurrent: ManualSyncContext["isCurrent"]; signal?: AbortSignal; timeoutMs?: number }
): Promise<ManualSyncResult> {
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  const deadlineAt = Date.now() + Math.min(45_000, options.timeoutMs ?? 45_000);
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, Math.max(0, deadlineAt - Date.now()));
  const context = { signal: controller.signal, deadlineAt, isCurrent: options.isCurrent };
  const refreshes = createOwnerSyncCoalescer<ManualLaneResult>();
  let latestRefresh: ManualLaneResult = { outcome: "partial", stage: "not_attempted" };

  async function execute(operation: Operation): Promise<ManualLaneResult> {
    if (controller.signal.aborted) return { outcome: "cancelled" };
    let release: (() => void) | undefined;
    const cancelled = new Promise<ManualLaneResult>((resolve) => {
      const cancel = () => resolve({ outcome: "cancelled", stage: "unfinished" });
      controller.signal.addEventListener("abort", cancel, { once: true });
      release = () => controller.signal.removeEventListener("abort", cancel);
    });
    try {
      return await Promise.race([
        cancelled,
        (async () => {
          if (!(await options.isCurrent()) || controller.signal.aborted)
            return { outcome: "cancelled" as const };
          const result = await operation(context);
          return !(await options.isCurrent()) || controller.signal.aborted
            ? { outcome: "cancelled" as const }
            : result;
        })()
      ]);
    } catch (error) {
      return { outcome: operations.classifyError(error) };
    } finally {
      release?.();
    }
  }
  const refresh = () =>
    refreshes.run(
      "pass",
      true,
      async () => {
        latestRefresh = await execute(operations.refresh);
        return latestRefresh;
      },
      async () => {}
    );

  async function complete(operation: Operation) {
    const result = await execute(operation);
    if (result.changed) await refresh();
    return result;
  }
  async function health(capture: Operation) {
    const captured = await execute(capture);
    if (captured.outcome !== "complete" || captured.stage === "disabled") return captured;
    const delivered = await complete(operations.healthDelivery);
    if (delivered.outcome !== "complete")
      return { ...delivered, stage: delivered.stage ?? "queued" };
    const processed = await complete(operations.healthReprocess);
    return { ...processed, stage: processed.stage ?? "processing" };
  }

  try {
    // A failed/hung Health type or Review request cannot gate another capture or Location.
    const [sleep, workouts, activity, review, location] = await Promise.all([
      health(operations.sleep),
      health(operations.workouts),
      complete(operations.activity),
      complete(operations.review),
      complete(operations.location)
    ]);
    await refresh();
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      lanes: { sleep, workouts, activity, review, location, refresh: latestRefresh }
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function manualSyncSummary(result: ManualSyncResult) {
  const describe = (lane: ManualLaneResult) => {
    if (lane.stage === "disabled") return "off";
    switch (lane.outcome) {
      case "complete":
        return lane.stage === "no_readable_samples" ? "no readable samples" : "complete";
      case "needs_attention":
        return "needs attention";
      case "authentication_required":
        return "sign-in required";
      case "transport_failure":
        return "waiting for connection";
      case "server_busy":
        return "server busy";
      case "cancelled":
        return "unfinished";
      default:
        return "work remaining";
    }
  };
  return (
    [
      ["Sleep", "sleep"],
      ["Workouts", "workouts"],
      ["Activity", "activity"],
      ["Review", "review"],
      ["Location", "location"],
      ["Refresh", "refresh"]
    ] as const
  )
    .map(([label, key]) => `${label}: ${describe(result.lanes[key])}`)
    .join("; ");
}
