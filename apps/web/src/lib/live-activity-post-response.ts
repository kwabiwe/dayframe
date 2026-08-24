import { after } from "next/server";
import type { RequestSession } from "./session";
import {
  notifyLiveActivitiesBestEffort,
  retryLiveActivityDeliveryBestEffort
} from "./live-activity-push";

/**
 * Registers Live Activity work with Next's request lifecycle without extending
 * the authoritative timer response. The durable outbox is populated before
 * delivery is attempted by notifyLiveActivitiesBestEffort.
 */
export function scheduleLiveActivityNotification(session: RequestSession) {
  schedulePostResponse("mutation", async () => {
    await notifyLiveActivitiesBestEffort(session);
  });
}

/** Rebuilds desired state and reconciles delivery outside a bootstrap response. */
export function scheduleLiveActivityRetry(session: RequestSession) {
  schedulePostResponse("reconciliation", async () => {
    await retryLiveActivityDeliveryBestEffort(session);
  });
}

function schedulePostResponse(
  source: "mutation" | "reconciliation",
  task: () => Promise<void>
) {
  try {
    after(async () => {
      try {
        await task();
      } catch (error) {
        // Best-effort helpers already contain their own logging. Keep this
        // outer guard so a future implementation cannot create an unhandled
        // rejection after the authoritative response has completed.
        logUnexpectedPostResponseFailure(source, error);
      }
    });
  } catch (error) {
    // A scheduling failure must never change an already committed timer
    // result. A later bootstrap task and the platform cron reconstruct desired
    // state from authoritative timers, including when no outbox row exists.
    logUnexpectedPostResponseFailure(source, error);
  }
}

function logUnexpectedPostResponseFailure(source: "mutation" | "reconciliation", error: unknown) {
  console.error("Dayframe Live Activity post-response task failed", {
    source,
    name: error instanceof Error ? error.name : "UnknownError"
  });
}
