import { useEffect, useRef, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import {
  AuthRequiredError,
  fetchBootstrap,
  readTimerEntryIdCorrelations,
  syncQueue
} from "@/lib/api";
import { useConnectivity } from "@/lib/connectivity";
import { IS_DAYFRAME_STAGING } from "@/lib/config";
import {
  createConnectivityRecoveryCoordinator,
  locationConnectivityRecoveryStepResult,
  reviewConnectivityRecoveryStepResult,
  runConnectivityRecoveryPass
} from "@/lib/connectivityRecovery";
import {
  getConnectivitySnapshot,
  reportConnectivityRecoveryCancelled,
  reportConnectivityRecoveryFinished,
  reportConnectivityRecoveryStarted
} from "@/lib/connectivityMonitor";
import {
  beginRecoveredDashboardBootstrapPublication
} from "@/lib/dashboardBootstrapChannel";
import {
  projectDurableLocalWork
} from "@/lib/durableLocalProjection";
import { readDurableLocalWork } from "@/lib/durableLocalWork";
import {
  getDurableWorkSnapshot,
  refreshDurableWorkSnapshot,
  subscribeDurableWork
} from "@/lib/durableWorkMonitor";
import { syncLocationIntelligenceOnForeground } from "@/lib/location/runtime";
import {
  mobileAccountKey,
  readActiveMobileAccount
} from "@/lib/mobileAccount";
import { isMobileTransportFailure } from "@/lib/mobile-network";
import {
  cacheDashboardBootstrap,
  getActiveReviewAccountIdentity,
  synchroniseReviewMutations
} from "@/lib/reviewSyncStore";
import { getActiveLocationAccountIdentity } from "@/lib/location/store";
import { drainNativeShortcutQueue } from "@/lib/shortcuts";
import { synchronisePendingTimerStops } from "@/lib/timerStopSync";
import { synchroniseTimeEntryCommands } from "@/lib/timeEntryOutbox";

export function ConnectivityRecoveryOwner() {
  const connectivity = useConnectivity();
  const durableWork = useSyncExternalStore(
    subscribeDurableWork,
    getDurableWorkSnapshot,
    getDurableWorkSnapshot
  );
  const connectivityRef = useRef(connectivity);
  const durableWorkRef = useRef(durableWork);
  const appActiveRef = useRef(AppState.currentState === "active");
  const previousPendingCount = useRef(0);
  const previousAccountKey = useRef<string | null>(null);
  connectivityRef.current = connectivity;
  durableWorkRef.current = durableWork;

  const coordinator = useRef<ReturnType<typeof createConnectivityRecoveryCoordinator> | null>(null);
  coordinator.current ??= createConnectivityRecoveryCoordinator({
    canStart: () =>
      appActiveRef.current &&
      connectivityRef.current.isOnline &&
      Boolean(durableWorkRef.current.accountKey),
    onPassStarted: (epoch) => {
      reportConnectivityRecoveryStarted(epoch);
      recordRecoveryLifecycle("start", { epoch });
    },
    onPassFinished: ({ epoch, hasPendingPass, result }) => {
      recordRecoveryLifecycle("end", { epoch, hasPendingPass, result });
      if (!hasPendingPass) {
        reportConnectivityRecoveryFinished({
          epoch,
          successful: result === "completed"
        });
      }
      void refreshDurableWorkSnapshot();
    },
    onRetryScheduled: ({ attempt, epoch, retryAt }) => {
      recordRecoveryLifecycle("retry", {
        attempt,
        epoch,
        retryAt: new Date(retryAt).toISOString()
      });
    },
    runPass: runRootRecoveryPass,
    shouldRetry: (result) =>
      result !== "authentication_required" &&
      result !== "interrupted" &&
      getDurableWorkSnapshot().pendingCount > 0
  });

  useEffect(() => {
    void refreshDurableWorkSnapshot();
    return () => coordinator.current?.dispose();
  }, []);

  useEffect(() => {
    const currentCoordinator = coordinator.current;
    if (!currentCoordinator) return;
    void refreshDurableWorkSnapshot();
    if (connectivity.isOffline) {
      currentCoordinator.pause();
      reportConnectivityRecoveryCancelled(connectivity.reconnectEpoch);
      return;
    }
    if (
      connectivity.isOnline &&
      appActiveRef.current &&
      durableWork.pendingCount > 0
    ) {
      void currentCoordinator.request(connectivity.reconnectEpoch, {
        queuedWorkArrived: true
      });
    }
  }, [connectivity.isOffline, connectivity.isOnline, connectivity.reconnectEpoch]);

  useEffect(() => {
    const currentCoordinator = coordinator.current;
    if (!currentCoordinator) return;
    const accountChanged = previousAccountKey.current !== durableWork.accountKey;
    const workArrived = durableWork.pendingCount > previousPendingCount.current;
    if (accountChanged && previousAccountKey.current !== null) {
      currentCoordinator.ignore(connectivity.reconnectEpoch);
    }
    previousAccountKey.current = durableWork.accountKey;
    previousPendingCount.current = durableWork.pendingCount;
    if (
      durableWork.accountKey &&
      durableWork.pendingCount > 0 &&
      (accountChanged || workArrived) &&
      connectivity.isOnline &&
      appActiveRef.current
    ) {
      void currentCoordinator.request(connectivity.reconnectEpoch, {
        queuedWorkArrived: true
      });
    }
  }, [connectivity.isOnline, connectivity.reconnectEpoch, durableWork]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      appActiveRef.current = state === "active";
      const currentCoordinator = coordinator.current;
      if (!currentCoordinator) return;
      if (!appActiveRef.current) {
        currentCoordinator.pause();
        return;
      }
      void refreshDurableWorkSnapshot().then((current) => {
        if (
          current.pendingCount > 0 &&
          connectivityRef.current.isOnline
        ) {
          void currentCoordinator.request(connectivityRef.current.reconnectEpoch, {
            queuedWorkArrived: true
          });
        }
      });
    });
    return () => subscription.remove();
  }, []);

  return null;
}

async function runRootRecoveryPass() {
  const owner = await readActiveMobileAccount();
  if (!owner) return "authentication_required" as const;
  const ownerKey = mobileAccountKey(owner);
  const canContinue = () => {
    const snapshot = getDurableWorkSnapshot();
    return AppState.currentState === "active" &&
      getConnectivitySnapshot().status === "online" &&
      snapshot.accountKey === ownerKey;
  };

  const result = await runConnectivityRecoveryPass({
    canContinue,
    isAuthenticationRequired: (error) => error instanceof AuthRequiredError,
    isTransportFailure: isMobileTransportFailure,
    onAuthenticationRequired: () => undefined,
    onStepOutcome: ({ step, durationMilliseconds, outcome }) => {
      recordRecoveryLifecycle("step", {
        durationMilliseconds,
        outcome,
        step
      });
    },
    steps: [
      {
        name: "timer_stops_ready",
        run: async () => {
          const result = await synchronisePendingTimerStops({
            owner,
            correlations: await readTimerEntryIdCorrelations(owner)
          });
          return result.transportFailure ? "transport_failure" : "continue";
        }
      },
      {
        name: "activity_queue",
        run: async () => {
          await drainNativeShortcutQueue(owner);
          const result = await syncQueue({ forceRetry: true });
          if (result.firstError?.failureKind === "network") return "transport_failure";
          return result.remaining.some((event) => event.failureKind !== "permanent")
            ? "application_failure"
            : "continue";
        }
      },
      {
        name: "time_entry_outbox",
        run: async () => {
          const result = await synchroniseTimeEntryCommands({
            owner,
            correlations: await readTimerEntryIdCorrelations(owner),
            force: true
          });
          if (result.reason === "retryable_failure") return "transport_failure";
          if (result.reason === "authentication_required" || result.reason === "session_changed") {
            throw new AuthRequiredError();
          }
          return result.waitingCount > 0 ? "application_failure" : "continue";
        }
      },
      {
        name: "timer_stops_after_correlation",
        run: async () => {
          const result = await synchronisePendingTimerStops({
            owner,
            correlations: await readTimerEntryIdCorrelations(owner)
          });
          if (result.transportFailure) return "transport_failure";
          return result.remaining.some((stop) => stop.failureKind !== "permanent")
            ? "application_failure"
            : "continue";
        }
      },
      {
        name: "review_outbox",
        run: async () => {
          const reviewOwner = await getActiveReviewAccountIdentity();
          if (
            reviewOwner?.userId !== owner.userId ||
            reviewOwner.workspaceId !== owner.workspaceId
          ) {
            return "continue";
          }
          return reviewConnectivityRecoveryStepResult(
            await synchroniseReviewMutations({ force: true })
          );
        }
      },
      {
        name: "location_intelligence",
        run: async () => {
          const locationOwner = await getActiveLocationAccountIdentity();
          if (
            locationOwner?.userId !== owner.userId ||
            locationOwner.workspaceId !== owner.workspaceId
          ) {
            return "continue";
          }
          return locationConnectivityRecoveryStepResult(
            await syncLocationIntelligenceOnForeground()
          );
        }
      },
      {
        name: "bootstrap",
        run: async () => {
          const publication = beginRecoveredDashboardBootstrapPublication();
          try {
            const serverBootstrap = await fetchBootstrap();
            if (
              serverBootstrap.user.id !== owner.userId ||
              serverBootstrap.workspace.id !== owner.workspaceId
            ) {
              throw new AuthRequiredError();
            }
            await cacheDashboardBootstrap(serverBootstrap);
            const projected = projectDurableLocalWork(
              serverBootstrap,
              await readDurableLocalWork(owner)
            );
            publication.publish(projected);
          } finally {
            publication.abandon();
          }
        }
      }
    ]
  });
  await refreshDurableWorkSnapshot();
  return result;
}

function recordRecoveryLifecycle(
  phase: "start" | "end" | "retry" | "step",
  details: Record<string, unknown>
) {
  if (!((typeof __DEV__ !== "undefined" && __DEV__) || IS_DAYFRAME_STAGING)) return;
  console.debug("Connectivity recovery", {
    timestamp: new Date().toISOString(),
    recoveryPhase: phase,
    ...details
  });
}
