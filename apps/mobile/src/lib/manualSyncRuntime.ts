import { AuthRequiredError, fetchBootstrap, syncQueue } from "./api";
import {
  getHealthImportPreferences,
  importHealthKitSleep,
  importHealthKitWorkouts,
  isHealthKitAutomaticSyncEnabled,
  reprocessExistingHealthReviewItems,
} from "./health";
import {
  mobileAccountKey,
  mobileAccountOwnersEqual,
  readActiveMobileAccount,
} from "./mobileAccount";
import {
  isMobileTransportFailure,
  MobileRequestTimeoutError,
  StaleMobileSessionResponseError,
} from "./mobile-network";
import {
  isAuthenticatedSessionSnapshotCurrent,
  readOwnedAuthenticatedSessionSnapshot,
} from "./secure-session";
import {
  cacheDashboardBootstrap,
  synchroniseReviewMutations,
} from "./reviewSyncStore";
import { syncLocationIntelligenceOnForeground } from "./location/runtime";
import { getActiveLocationAccountIdentity } from "./location/store";
import { beginRecoveredDashboardBootstrapPublication } from "./dashboardBootstrapChannel";
import { projectDurableLocalWork } from "./durableLocalProjection";
import { readDurableLocalWork } from "./durableLocalWork";
import {
  runManualSync,
  type ManualLaneResult,
  type ManualSyncContext,
  type ManualSyncResult,
} from "./syncCoordinator";
import type { SyncLaneOutcome } from "./syncLane";
import { createOwnerSyncCoalescer } from "./ownerSyncCoalescer";

const manualPasses = createOwnerSyncCoalescer<ManualSyncResult>();
let lastManualResult: { key: string; result: ManualSyncResult } | null = null;
export async function getLastManualSyncResult() {
  const owner = await readActiveMobileAccount();
  return owner && lastManualResult?.key === mobileAccountKey(owner)
    ? lastManualResult.result
    : null;
}

/** Manual work retains one explicit follow-up per authenticated owner/generation; network failures never gate local capture. */
export async function synchroniseDeviceNow(options: { date?: string } = {}) {
  const owner = await readActiveMobileAccount();
  if (!owner) throw new AuthRequiredError();
  const session = await readOwnedAuthenticatedSessionSnapshot(owner);
  if (session.status !== "authenticated") throw new AuthRequiredError();
  const key = mobileAccountKey(owner);
  const isCurrent = async () =>
    isAuthenticatedSessionSnapshotCurrent(session.snapshot) &&
    mobileAccountOwnersEqual(owner, await readActiveMobileAccount());

  // Each capture must enqueue a drain after its own durable handoff. syncQueue already
  // serializes by owner; joining an older selected pass can strand a later capture.
  const deliver = async (
    context: ManualSyncContext,
  ): Promise<ManualLaneResult> => {
    if (context.signal.aborted || !(await isCurrent()))
      return { outcome: "cancelled" };
    const result = await syncQueue({
      forceRetry: true,
      signal: context.signal,
    });
    const outcome: SyncLaneOutcome =
      result.firstError?.failureKind === "network"
        ? "transport_failure"
        : result.remaining.some((item) => item.failureKind === "permanent")
          ? "needs_attention"
          : result.remainingCount
            ? "partial"
            : "complete";
    return {
      outcome,
      changed: result.syncedCount > 0,
      remainingCount: result.remainingCount,
      stage: result.remainingCount ? "queued" : "uploaded",
    };
  };

  const capture =
    (type: "sleep" | "workouts") =>
    async (context: ManualSyncContext): Promise<ManualLaneResult> => {
      const preferences = await getHealthImportPreferences();
      const enabled = await isHealthKitAutomaticSyncEnabled();
      const selected =
        type === "sleep"
          ? preferences.sleep
          : Object.entries(preferences).some(
              ([kind, value]) => kind !== "sleep" && value,
            );
      if (!enabled || !selected)
        return { outcome: "complete", stage: "disabled" };
      if (!(await isCurrent()) || context.signal.aborted)
        return { outcome: "cancelled" };
      const result = await (
        type === "sleep" ? importHealthKitSleep : importHealthKitWorkouts
      )({
        signal: context.signal,
      });
      return {
        outcome:
          "partial" in result && result.partial === true
            ? "partial"
            : String(result.status) === "error"
              ? "needs_attention"
              : "complete",
        stage: result.importedCount ? "captured" : "query_completed",
      };
    };

  return manualPasses.run(`${key}:${session.snapshot.generation}`, true, () => runManualSync(
    {
      sleep: capture("sleep"),
      workouts: capture("workouts"),
      activity: deliver,
      healthDelivery: deliver,
      async healthReprocess(context) {
        const result = await reprocessExistingHealthReviewItems(undefined, {
          force: true,
          signal: context.signal,
          deadlineAt: context.deadlineAt,
        });
        return {
          outcome: !result.ok
            ? "server_busy"
            : result.partial || result.hasMore || result.failedCount
              ? "partial"
              : "complete",
          stage: "processed",
          changed:
            result.confirmedCount +
              result.ignoredCount +
              result.updatedCategoryCount +
              result.repairedSleepEntryCount >
            0,
          remainingCount: result.remainingReviewCount,
        };
      },
      async review(context) {
        const result = await synchroniseReviewMutations({
          force: true,
          signal: context.signal,
          deadlineAt: context.deadlineAt,
        });
        return {
          outcome: result.outcome ?? "partial",
          changed: result.acknowledgedCount > 0,
          remainingCount: result.waitingCount + result.needsAttentionCount,
        };
      },
      async location(context) {
        if (
          !mobileAccountOwnersEqual(
            owner,
            await getActiveLocationAccountIdentity(),
          )
        )
          return { outcome: "needs_attention", stage: "owner_unavailable" };
        const result = await syncLocationIntelligenceOnForeground({
          forceUploadRetry: true,
          forceReplay: true,
          signal: context.signal,
          deadlineAt: context.deadlineAt,
        });
        if (result.reason === "v1")
          return { outcome: "complete", stage: "disabled" };
        return {
          outcome: result.outcome ?? "partial",
          changed:
            (result.acknowledgedCount ?? 0) > 0 ||
            ("semanticSegmentCount" in result &&
              (result.semanticSegmentCount ?? 0) > 0),
          remainingCount: result.remainingEvidenceCount ?? undefined,
        };
      },
      async refresh(context) {
        const publication = beginRecoveredDashboardBootstrapPublication();
        try {
          const bootstrap = await fetchBootstrap({
            date: options.date,
            signal: context.signal,
            deadlineAt: context.deadlineAt,
          });
          if (
            !(await isCurrent()) ||
            context.signal.aborted ||
            !mobileAccountOwnersEqual(owner, {
              userId: bootstrap.user.id,
              workspaceId: bootstrap.workspace.id,
            })
          )
            throw new StaleMobileSessionResponseError();
          await cacheDashboardBootstrap(bootstrap);
          const projected = projectDurableLocalWork(
            bootstrap,
            await readDurableLocalWork(owner),
          );
          if (!(await isCurrent()) || context.signal.aborted)
            throw new StaleMobileSessionResponseError();
          publication.publish(projected);
          return { outcome: "complete" };
        } finally {
          publication.abandon();
        }
      },
      classifyError(error) {
        if (error instanceof AuthRequiredError)
          return "authentication_required";
        if (
          error instanceof StaleMobileSessionResponseError ||
          (error instanceof Error && error.name === "AbortError")
        )
          return "cancelled";
        if (isMobileTransportFailure(error)) return "transport_failure";
        if (error instanceof MobileRequestTimeoutError) return "server_busy";
        return "needs_attention";
      },
    },
    { isCurrent },
  )
    .then(async (result) => {
      if (await isCurrent()) lastManualResult = { key, result };
      return result;
    }), () => Promise.resolve());
}
