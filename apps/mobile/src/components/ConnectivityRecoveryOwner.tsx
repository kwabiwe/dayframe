import {dueSyncLanes,nextSyncWorkDueAt} from "@/lib/syncDueTimes";
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
  connectivityAllowsRecovery,
  createConnectivityRecoveryCoordinator,
  connectivityRecoveryRequest,
  foregroundRecoveryRequest,
  locationConnectivityRecoveryStepResult,
  reviewConnectivityRecoveryStepResult,
  runConnectivityRecoveryPass,
  shouldRetryConnectivityRecovery
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
  readOwnedAuthenticatedSessionSnapshot,
  subscribeAuthenticatedSession
} from "@/lib/secure-session";
import {
  cacheDashboardBootstrap,
  getActiveReviewAccountIdentity,
  synchroniseReviewMutations
} from "@/lib/reviewSyncStore";
import { getActiveLocationAccountIdentity } from "@/lib/location/store";
import { drainNativeShortcutQueue } from "@/lib/shortcuts";
import { synchronisePendingTimerStops } from "@/lib/timerStopSync";
import { synchroniseTimeEntryCommands } from "@/lib/timeEntryOutbox";
import {
  beginTimerBackgroundExecution,
  endAllTimerBackgroundExecution,
  type TimerBackgroundExecutionLease
} from "@/lib/timerBackgroundExecution";

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
    canStart: () => {
      const currentDurableWork = getDurableWorkSnapshot();
      return AppState.currentState === "active" &&
        connectivityAllowsRecovery(getConnectivitySnapshot()) &&
        Boolean(currentDurableWork.accountKey);
    },
    hasPendingWork: () => getDurableWorkSnapshot().pendingCount > 0,
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
    nextDueAt:()=>nextSyncWorkDueAt(getDurableWorkSnapshot().retryLanes),
    runPass: runRootRecoveryPass,
    shouldRetry: (result) => shouldRetryConnectivityRecovery(
      result,
      getDurableWorkSnapshot().pendingCount
    )
  });

  useEffect(() => {
    void refreshDurableWorkSnapshot();
    return () => {
      coordinator.current?.dispose();
      void endAllTimerBackgroundExecution("teardown");
    };
  }, []);

  useEffect(() => subscribeAuthenticatedSession(() => {
    const currentCoordinator = coordinator.current;
    if (!currentCoordinator) return;
    void refreshDurableWorkSnapshot().then((current) => {
      const request = connectivityRecoveryRequest({
        accountKey: current.accountKey,
        appActive: appActiveRef.current,
        isOnline: connectivityRef.current.isOnline,
        pendingCount: current.pendingCount,
        reconnectEpoch: connectivityRef.current.reconnectEpoch
      });
      if (request) void currentCoordinator.request(request.epoch, request.options);
    });
  }), []);

  useEffect(() => {
    const currentCoordinator = coordinator.current;
    if (!currentCoordinator) return;
    void refreshDurableWorkSnapshot();
    if (!connectivityAllowsRecovery(connectivity)) {
      currentCoordinator.pause();
      reportConnectivityRecoveryCancelled(connectivity.reconnectEpoch);
      void endAllTimerBackgroundExecution("cancelled");
      return;
    }
    if (connectivity.isOffline) {
      if (
        appActiveRef.current &&
        durableWork.accountKey &&
        !currentCoordinator.snapshot().inFlight
      ) {
        void currentCoordinator.request(connectivity.reconnectEpoch, {
          forcePass: true
        });
      }
      return;
    }
    if (connectivity.source === "http" && currentCoordinator.snapshot().inFlight) {
      return;
    }
    const request = connectivityRecoveryRequest({
      accountKey: durableWork.accountKey,
      appActive: appActiveRef.current,
      isOnline: connectivity.isOnline,
      pendingCount: durableWork.pendingCount,
      reconnectEpoch: connectivity.reconnectEpoch
    });
    if (request) {
      void currentCoordinator.request(request.epoch, request.options);
    }
  }, [
    connectivity.isConnected,
    connectivity.isInternetReachable,
    connectivity.isOffline,
    connectivity.isOnline,
    connectivity.reconnectEpoch,
    connectivity.source,
    durableWork.accountKey
  ]);

  useEffect(() => {
    const currentCoordinator = coordinator.current;
    if (!currentCoordinator) return;
    const accountChanged = previousAccountKey.current !== durableWork.accountKey;
    const workArrived = durableWork.pendingCount > previousPendingCount.current;
    if (accountChanged && previousAccountKey.current !== null) {
      currentCoordinator.ignore(connectivity.reconnectEpoch);
      void endAllTimerBackgroundExecution("account_changed");
    }
    previousAccountKey.current = durableWork.accountKey;
    previousPendingCount.current = durableWork.pendingCount;
    if (
      durableWork.accountKey &&
      (accountChanged || workArrived) &&
      connectivity.isOnline &&
      appActiveRef.current
    ) {
      void currentCoordinator.request(connectivity.reconnectEpoch, {
        ...(workArrived ? { queuedWorkArrived: true } : {}),
        ...(accountChanged && connectivity.reconnectEpoch > 0
          ? { forcePass: true }
          : {})
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
        const request = foregroundRecoveryRequest({
          accountKey: current.accountKey,
          isOnline: connectivityAllowsRecovery(connectivityRef.current),
          reconnectEpoch: connectivityRef.current.reconnectEpoch
        });
        if (request) {
          void currentCoordinator.request(request.epoch, request.options);
        }
      });
    });
    return () => subscription.remove();
  }, []);

  return null;
}

async function runRootRecoveryPass(_epoch?:number, context?:{dueOnly:boolean}) {
  const snapshot=await refreshDurableWorkSnapshot();
  const due=dueSyncLanes(context?.dueOnly?snapshot.retryLanes:undefined);
  let changed=false;
  const owner = await readActiveMobileAccount();
  if (!owner) return "authentication_required" as const;
  const sessionRead = await readOwnedAuthenticatedSessionSnapshot(owner);
  if (sessionRead.status !== "authenticated") {
    return "authentication_required" as const;
  }
  const ownerKey = mobileAccountKey(owner);
  let timerBackgroundLease: TimerBackgroundExecutionLease | null = null;
  let timerPhaseActive = due.has("timer") && getDurableWorkSnapshot().timerMutationCount > 0;
  let timerPhaseEnded = !timerPhaseActive;
  if (timerPhaseActive) {
    timerBackgroundLease = await beginTimerBackgroundExecution(
      "Dayframe timer mutation recovery"
    );
  }
  const endTimerPhase = async (reason: "success" | "failure" | "cancelled") => {
    if (timerPhaseEnded) return;
    timerPhaseEnded = true;
    timerPhaseActive = false;
    await timerBackgroundLease?.end(reason);
  };
  const canContinue = () => {
    const snapshot = getDurableWorkSnapshot();
    const timerCanContinue = timerPhaseActive &&
      timerBackgroundLease !== null &&
      !timerBackgroundLease.signal.aborted;
    return (AppState.currentState === "active" || timerCanContinue) &&
      connectivityAllowsRecovery(getConnectivitySnapshot()) &&
      snapshot.accountKey === ownerKey;
  };

  try {
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
            if(!due.has("timer"))return "continue";
            const result = await synchronisePendingTimerStops({
              owner,
              correlations: await readTimerEntryIdCorrelations(owner),
              signal: timerBackgroundLease?.signal
            });
            changed ||= result.deliveredCount>0;
            return result.transportFailure ? "transport_failure" : "continue";
          }
        },
        {
          name: "timer_activity_queue",
          run: async () => {
            if(!due.has("timer"))return "continue";
            await drainNativeShortcutQueue(owner);
            const result = await syncQueue({
              eventScope: "timer_mutations",
              forceRetry: true,
              signal: timerBackgroundLease?.signal
            });
            changed ||= result.syncedCount>0;
            if (result.firstError?.failureKind === "network") return "transport_failure";
            return result.remaining.some((event) => event.failureKind !== "permanent")
              ? "application_failure"
              : "continue";
          }
        },
        {
          name: "time_entry_outbox",
          run: async () => {
            if(!due.has("timer"))return "continue";
            const result = await synchroniseTimeEntryCommands({
              owner,
              correlations: await readTimerEntryIdCorrelations(owner),
              signal: timerBackgroundLease?.signal
            });
            changed ||= result.deliveredCount>0;
            if (result.reason === "retryable_failure") return "transport_failure";
            if (
              result.reason === "authentication_required" ||
              result.reason === "session_changed"
            ) {
              throw new AuthRequiredError();
            }
            return result.waitingCount > 0 ? "application_failure" : "continue";
          }
        },
        {
          name: "timer_stops_after_correlation",
          run: async () => {
            if(!due.has("timer"))return "continue";
            try {
              const result = await synchronisePendingTimerStops({
                owner,
                correlations: await readTimerEntryIdCorrelations(owner),
                signal: timerBackgroundLease?.signal
              });
              changed ||= result.deliveredCount>0;
              if (result.transportFailure) return "transport_failure";
              return result.remaining.some((stop) => stop.failureKind !== "permanent")
                ? "application_failure"
                : "continue";
            } finally {
              await endTimerPhase(
                timerBackgroundLease?.signal.aborted ? "cancelled" : "success"
              );
            }
          }
        },
        {
          name: "activity_queue",
          run: async () => {
            if(!due.has("activity"))return "continue";
            const result = await syncQueue({
              eventScope: "non_timer",
              forceRetry: false
            });
            changed ||= result.syncedCount>0;
            if (result.firstError?.failureKind === "network") return "transport_failure";
            return result.remaining.some((event) => event.failureKind !== "permanent")
              ? "application_failure"
              : "continue";
          }
        },
        {
          name: "review_outbox",
          run: async () => {
            if(!due.has("review"))return "continue";
            const reviewOwner = await getActiveReviewAccountIdentity();
            if (
              reviewOwner?.userId !== owner.userId ||
              reviewOwner.workspaceId !== owner.workspaceId
            ) {
              return "continue";
            }
            const result=await synchroniseReviewMutations();changed ||= result.acknowledgedCount>0;
            return reviewConnectivityRecoveryStepResult(result);
          }
        },
        {
          name: "location_intelligence",
          run: async () => {
            if(!due.has("location"))return "continue";
            const locationOwner = await getActiveLocationAccountIdentity();
            if (
              locationOwner?.userId !== owner.userId ||
              locationOwner.workspaceId !== owner.workspaceId
            ) {
              return "continue";
            }
            const result=await syncLocationIntelligenceOnForeground({forceReplay:!context?.dueOnly});
            changed ||= (result.acknowledgedCount??0)>0 || ("semanticSegmentCount" in result && (result.semanticSegmentCount??0)>0);
            return locationConnectivityRecoveryStepResult(result);
          }
        },
        {
          name: "bootstrap",
          run: async () => {
            if(context?.dueOnly&&!changed)return "continue";
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
  } finally {
    await endTimerPhase(timerBackgroundLease?.signal.aborted ? "cancelled" : "failure");
  }
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
