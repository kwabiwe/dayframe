import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  isIanaTimeZone,
  type ReviewPresentationRequest,
  type ReviewPresentationSnapshot
} from "@dayframe/shared";
import { DAYFRAME_BACKEND_ID } from "@/lib/backendIdentity";
import { AuthRequiredError, type MobileBootstrap, type MobileTimeEntry } from "@/lib/api";
import {
  cacheReviewPresentation,
  recordReviewPresentationRead,
  readAcknowledgedReviewHandoverLookup,
  readReviewPresentationSnapshot,
  reviewPresentationScopeKey,
  subscribeReviewSync,
  type ReviewPresentationOwner,
  type ReviewPresentationStoreSnapshot
} from "@/lib/reviewSyncStore";
import {
  fetchReviewPresentationSnapshot,
  ReviewPresentationSnapshotChangedError,
  ReviewPresentationValidationError
} from "@/lib/reviewPresentationClient";
import { reconcileAcknowledgedReviewPresentationHandover } from "@/lib/reviewPresentationHandover";
import { isMobileTransportFailure } from "@/lib/mobile-network";
import {
  projectTodayReviewPresentation,
  type TodayReviewPresentation
} from "@/lib/todayReviewPresentation";

export type TodayReviewPresentationState = {
  owner: ReviewPresentationOwner | null;
  scope: ReviewPresentationSnapshot["scope"] | null;
  snapshot: ReviewPresentationStoreSnapshot | null;
  presentation: TodayReviewPresentation | null;
  isLoading: boolean;
  error: string | null;
  /** Safe classification only; raw transport/server details never reach Today. */
  errorKind: TodayReviewPresentationErrorKind | null;
};

export type TodayReviewPresentationErrorKind =
  | "offline"
  | "server"
  | "validation"
  | "cache"
  | "snapshot_changed";

type Input = {
  bootstrap: MobileBootstrap | null;
  dashboardEntries: readonly MobileTimeEntry[];
  manualProjectedEntries: readonly MobileTimeEntry[];
  isFocused: boolean;
  nowMs: number;
  refreshGeneration?: number;
};

type NetworkRead = {
  controller: AbortController;
  key: string;
  queued: boolean;
  running: boolean;
};

class PresentationCacheError extends Error {
  constructor() {
    super("Review presentation cache is unavailable.");
    this.name = "PresentationCacheError";
  }
}

/**
 * One foreground display-read coordinator for Today. It only owns cancellable
 * presentation reads; durable Review delivery remains in reviewSyncStore.
 */
export function useTodayReviewPresentation(input: Input): TodayReviewPresentationState {
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === "active");
  const dayKey = localDayKey(input.nowMs);
  const timeZone = useMemo(() => currentTimeZone(), []);
  const scope = useMemo(() => timeZone ? windowScopeFor(dayKey, timeZone) : null, [dayKey, timeZone]);
  const owner = useMemo(() => reviewOwner(input.bootstrap), [input.bootstrap]);
  const ownerKey = owner ? `${owner.backendId}:${owner.workspaceId}:${owner.userId}` : null;
  const scopeKey = owner && scope
    ? reviewPresentationScopeKey(owner.backendId, { scope })
    : null;
  const [snapshot, setSnapshot] = useState<ReviewPresentationStoreSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<TodayReviewPresentationErrorKind | null>(null);
  const [projectionNowMs, setProjectionNowMs] = useState(() => Date.now());
  const [queuedReadSequence, setQueuedReadSequence] = useState(0);
  const identityGeneration = useRef(0);
  const read = useRef<NetworkRead | null>(null);
  const acknowledgedHandoverSignature = useRef<string | null>(null);

  const setPresentationError = useCallback((kind: TodayReviewPresentationErrorKind) => {
    setErrorKind(kind);
    setError(presentationErrorCopy(kind));
    if (owner) recordReviewPresentationRead(owner, "today", kind);
  }, [ownerKey]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      setAppIsActive(next === "active");
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => () => read.current?.controller.abort(), []);

  useEffect(() => {
    identityGeneration.current += 1;
    acknowledgedHandoverSignature.current = null;
    setSnapshot(null);
    setError(null);
    setErrorKind(null);
    if (!owner || !scope) return;
    const generation = identityGeneration.current;
    void readCachedSnapshot({ owner, scope }).then((next) => {
      if (generation !== identityGeneration.current) return;
      setSnapshot(next);
      if (next) setProjectionNowMs(Date.now());
    }).catch(() => {
      if (generation !== identityGeneration.current) return;
      setPresentationError("cache");
    });
  }, [ownerKey, scopeKey, setPresentationError]);

  useEffect(() => {
    if (!owner || !scope) return;
    let disposed = false;
    let scheduled = false;
    const queueAcknowledgedHandoverRead = () => {
      const generation = identityGeneration.current;
      void readAcknowledgedReviewHandoverLookup({ owner }).then((handover) => {
        if (disposed || generation !== identityGeneration.current) return;
        if (!handover) {
          acknowledgedHandoverSignature.current = null;
          return;
        }
        if (acknowledgedHandoverSignature.current === handover.signature) return;
        acknowledgedHandoverSignature.current = handover.signature;
        // An acknowledgement is a local durable-state change, not a network
        // delivery trigger. Queue one cancellable foreground read so its
        // explicit terminal/result proof can be materialised by the existing
        // store without polling or a second sync owner.
        setQueuedReadSequence((current) => current + 1);
      }).catch(() => undefined);
    };
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (disposed) return;
        const generation = identityGeneration.current;
        void readCachedSnapshot({ owner, scope }).then((next) => {
          if (disposed || generation !== identityGeneration.current) return;
          setSnapshot(next);
          if (next) setProjectionNowMs(Date.now());
        }).catch(() => {
          if (disposed || generation !== identityGeneration.current) return;
          setPresentationError("cache");
        });
      });
      queueAcknowledgedHandoverRead();
    };
    queueAcknowledgedHandoverRead();
    return subscribeReviewSync(refresh);
  }, [ownerKey, scopeKey, setPresentationError]);

  const bootstrapRefreshKey = input.bootstrap
    ? `${input.bootstrap.workspace.id}:${input.bootstrap.user.id}:${input.bootstrap.serverBuild?.sourceSha ?? "local"}:${input.bootstrap.reviewItems.length}:${input.bootstrap.entries.length}`
    : "none";
  const explicitRefreshKey = input.refreshGeneration ?? 0;

  useEffect(() => {
    if (!owner || !scope || !scopeKey || !input.isFocused || !appIsActive) {
      const current = read.current;
      if (current?.running) current.controller.abort();
      if (current) read.current = null;
      setIsLoading(false);
      return;
    }
    const currentKey = `${ownerKey}:${scopeKey}`;
    const existing = read.current;
    if (existing?.running && existing.key === currentKey) {
      existing.queued = true;
      return;
    }
    if (existing?.running) existing.controller.abort();
    const controller = new AbortController();
    const operation: NetworkRead = { controller, key: currentKey, queued: false, running: true };
    read.current = operation;
    const generation = identityGeneration.current;
    setIsLoading(true);

    const run = async () => {
      try {
        const request: Omit<ReviewPresentationRequest, "cursor"> = {
          version: 1,
          ...scope,
          limit: 200
        };
        const response = await fetchReviewPresentationSnapshot({
          owner,
          request,
          signal: controller.signal
        });
        if (generation !== identityGeneration.current || controller.signal.aborted) return;
        let wrote: boolean;
        try {
          wrote = await cacheReviewPresentation({ owner, response });
        } catch {
          throw new PresentationCacheError();
        }
        if (!wrote) throw new PresentationCacheError();
        if (generation !== identityGeneration.current || controller.signal.aborted) return;
        const handover = await reconcileAcknowledgedReviewPresentationHandover({
          owner,
          timeZone: scope.timeZone,
          signal: controller.signal
        });
        if (handover.signature) acknowledgedHandoverSignature.current = handover.signature;
        if (generation !== identityGeneration.current || controller.signal.aborted) return;
        let next: ReviewPresentationStoreSnapshot | null;
        try {
          next = await readCachedSnapshot({ owner, scope });
        } catch {
          throw new PresentationCacheError();
        }
        if (!next) throw new PresentationCacheError();
        if (generation !== identityGeneration.current || controller.signal.aborted) return;
        setSnapshot(next);
        setProjectionNowMs(Date.now());
        setError(null);
        setErrorKind(null);
        recordReviewPresentationRead(owner, "today", "success");
      } catch (cause) {
        if (controller.signal.aborted || generation !== identityGeneration.current) return;
        // Authentication/session recovery belongs to the existing auth owner.
        if (cause instanceof AuthRequiredError) return;
        // A failed foreground read never changes durable delivery state. Clear
        // only this ephemeral de-duplication token so a later existing
        // foreground/subscription trigger may retry the proof; do not create a
        // timer or polling loop here.
        acknowledgedHandoverSignature.current = null;
        // A malformed or unavailable new response leaves the last verified
        // snapshot mounted and qualified instead of replacing it with zero.
        setPresentationError(presentationErrorKind(cause));
      } finally {
        if (read.current !== operation) return;
        operation.running = false;
        read.current = null;
        setIsLoading(false);
        if (operation.queued && generation === identityGeneration.current && input.isFocused && appIsActive) {
          // One coalesced rerun is enough for all updates that arrived while
          // this owner/scope read was in flight. It deliberately does not
          // create a delivery/retry loop: only a new foreground trigger can
          // queue another read.
          setQueuedReadSequence((current) => current + 1);
        }
      }
    };
    void run();
  }, [appIsActive, bootstrapRefreshKey, explicitRefreshKey, input.isFocused, ownerKey, queuedReadSequence, scopeKey, setPresentationError]);

  const presentation = useMemo(() => {
    if (!owner || !scope || !snapshot) return null;
    const today = scope.today;
    if (!today) return null;
    return projectTodayReviewPresentation({
      ownerKey: ownerKey!,
      snapshotOwnerKey: ownerKey!,
      response: snapshot.response,
      effects: snapshot.effects,
      dashboardEntries: input.dashboardEntries,
      manualProjectedEntries: input.manualProjectedEntries,
      day: {
        key: dayKey,
        startMs: Date.parse(today.start),
        endMs: Date.parse(today.end)
      },
      // Do not make a running timer re-query/rebuild the Review chart every
      // second. A committed store/cache change refreshes this bounded instant.
      nowMs: projectionNowMs
    });
  }, [
    dayKey,
    input.dashboardEntries,
    input.manualProjectedEntries,
    owner,
    ownerKey,
    projectionNowMs,
    scope,
    snapshot
  ]);

  return { owner, scope, snapshot, presentation, isLoading, error, errorKind };
}

async function readCachedSnapshot(input: {
  owner: ReviewPresentationOwner;
  scope: ReviewPresentationSnapshot["scope"];
}) {
  return readReviewPresentationSnapshot({ owner: input.owner, response: { scope: input.scope } });
}

function reviewOwner(bootstrap: MobileBootstrap | null): ReviewPresentationOwner | null {
  if (!bootstrap || !DAYFRAME_BACKEND_ID) return null;
  const declaredBackend = bootstrap.serverBuild?.backendId;
  if (declaredBackend && declaredBackend !== DAYFRAME_BACKEND_ID) return null;
  return {
    backendId: DAYFRAME_BACKEND_ID,
    workspaceId: bootstrap.workspace.id,
    userId: bootstrap.user.id
  };
}

function windowScopeFor(dayKey: string, timeZone: string): ReviewPresentationSnapshot["scope"] {
  const todayStart = localDateForKey(dayKey);
  const tomorrow = new Date(todayStart);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const windowStart = new Date(todayStart);
  windowStart.setDate(windowStart.getDate() - 59);
  return {
    mode: "window",
    timeZone,
    window: { start: windowStart.toISOString(), end: tomorrow.toISOString() },
    today: { start: todayStart.toISOString(), end: tomorrow.toISOString() }
  };
}

function localDateForKey(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const value = new Date(year, month - 1, day);
  value.setHours(0, 0, 0, 0);
  return value;
}

function localDayKey(nowMs: number) {
  const date = new Date(nowMs);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function currentTimeZone() {
  const value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return value && isIanaTimeZone(value) ? value : null;
}

function presentationErrorKind(cause: unknown): TodayReviewPresentationErrorKind {
  if (cause instanceof ReviewPresentationSnapshotChangedError) return "snapshot_changed";
  if (cause instanceof ReviewPresentationValidationError) return "validation";
  if (cause instanceof PresentationCacheError) return "cache";
  if (isMobileTransportFailure(cause)) return "offline";
  return "server";
}

function presentationErrorCopy(kind: TodayReviewPresentationErrorKind) {
  switch (kind) {
    case "offline":
      return "Today could not reach Dayframe. Showing the last saved view when available.";
    case "validation":
      return "Today received an unavailable summary. Showing the last saved view when available.";
    case "cache":
      return "Today could not read its saved summary. Pull to refresh.";
    case "snapshot_changed":
      return "Review changed while Today was loading. Showing the last saved view.";
    case "server":
      return "Review could not refresh. Showing the last saved view when available.";
  }
}
