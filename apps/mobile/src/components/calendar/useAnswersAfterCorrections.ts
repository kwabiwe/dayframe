import { useEffect, useMemo, useRef, useState } from "react";
import type { MobileBootstrap } from "../../lib/api";
import type { MobileAccountOwner } from "../../lib/mobileAccount";
import { isOpenReviewItem } from "../../lib/review";
import { reviewAnswerMutation } from "../../lib/reviewAnswer";
import { reviewAnswersDecided } from "../../lib/reviewAnswerClaims";
import {
  answeredReviewItemIds,
  readAnswersAfterCorrectionsWithState,
  recoverAnswersAfterCorrections,
  releaseAnswersAfterCorrections,
  subscribeAnswersAfterCorrections,
  type AnswerAfterCorrectionsRelease
} from "../../lib/reviewAnswersAfterCorrections";
import { enqueueReviewMutation, synchroniseReviewMutations } from "../../lib/reviewSyncStore";
import {
  enqueueTimelineCorrections,
  readAcknowledgedTimelineCorrections,
  readPendingTimelineCorrections,
  subscribeTimelineCorrectionOutbox,
  synchroniseTimelineCorrections
} from "../../lib/timelineCorrectionOutbox";
import { AccessibilityInfo, Alert, AppState } from "react-native";
import { sayIfStillHere } from "../../lib/guardedNotice";

const NONE: ReadonlySet<string> = new Set();

/**
 * The Dashboard's side of answers waiting for corrections (Codex r2 on #610; `reviewAnswersAfterCorrections`):
 * which "?" wait (they stay out of the List and Grid meanwhile), and the release — once every correction an answer
 * waits for is acknowledged, it goes into the Review outbox under its own id, the deck's path, as the "?" is now.
 * Run when Dayframe opens (an answer from before a relaunch is released then), whenever the correction outbox or
 * the waiting answers change, and on every new read of the day's data. A dropped answer (a refused change) leaves
 * its "?" in the List; the refusal's own notice says the change wasn't saved.
 */
export function useAnswersAfterCorrections({ data, onDropped, owner, release }: {
  data: MobileBootstrap | null;
  /**
   * A waiting answer dropped (its change refused) or given up (its record couldn't be let go): its "?" — and an
   * outing's trips — shown again at once (Codex r3 and r11 on #610).
   */
  onDropped?: (reviewItemIds: readonly string[]) => void;
  owner: MobileAccountOwner | null;
  /** Tests: what a release does (the Review outbox otherwise). */
  release?: AnswerAfterCorrectionsRelease;
}) {
  const userId = owner?.userId ?? null;
  const workspaceId = owner?.workspaceId ?? null;
  const key = userId && workspaceId ? `${workspaceId}:${userId}` : null;
  const [waiting, setWaiting] = useState<{ key: string; ids: ReadonlySet<string>; segments: ReadonlySet<string> } | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const releaseRef = useRef(release);
  releaseRef.current = release;
  const droppedRef = useRef(onDropped);
  droppedRef.current = onDropped;
  const [dataRead, setDataRead] = useState(0);
  const lastData = useRef(data);
  useEffect(() => {
    if (lastData.current === data) return;
    lastData.current = data;
    setDataRead((count) => count + 1);
  }, [data]);
  useEffect(() => {
    if (!userId || !workspaceId) return;
    const who = { userId, workspaceId };
    const ownerKey = `${workspaceId}:${userId}`;
    let live = true;
    const viaReviewOutbox: AnswerAfterCorrectionsRelease = async (record) => {
      if (record.log) {
        // A Logs as (Codex r4 on #610): its corrections are acknowledged, so `log_place` goes now, under the record's
        // own id (a repeat after a crash is answered once, #597); the server closes the place's "?" with it (#609).
        await enqueueTimelineCorrections(who, [{ request: { kind: "log_place", subject: "place", itemId: record.log.itemId,
          categoryId: record.log.categoryId, clientCorrectionId: record.id } }]);
        void synchroniseTimelineCorrections({ owner: who, force: true, isForeground: () => AppState.currentState === "active" }).catch(() => undefined);
        return "released";
      }
      const bootstrap = dataRef.current;
      if (!bootstrap || bootstrap.user.id !== who.userId || bootstrap.workspace.id !== who.workspaceId) return "wait";
      const item = bootstrap.reviewItems.find((each) => each.id === record.reviewItemId);
      if (!item) return "wait";
      if (!isOpenReviewItem(item)) return "gone";
      // An outing answered with its trips (Codex r10 on #610): every trip as the server has it now.
      const members = (record.outingMemberIds ?? []).map((id) => bootstrap.reviewItems.find((each) => each.id === id));
      if (members.some((member) => !member)) return "wait";
      if (members.some((member) => !isOpenReviewItem(member!))) return "gone";
      // Decided meanwhile on this phone (the deck): not this answer's to save.
      if ((await reviewAnswersDecided(bootstrap, [item.id, ...(record.outingMemberIds ?? [])])).size) return "gone";
      await enqueueReviewMutation({ bootstrap, item, clientMutationId: record.id,
        mutation: reviewAnswerMutation(item, record.logged, record.outingMemberIds?.length ? { outingMemberIds: record.outingMemberIds } : {}),
        ...(members.length ? { affectedItems: [item, ...members.map((member) => member!)] } : {}) });
      void synchroniseReviewMutations().catch(() => undefined);
      return "released";
    };
    // Hiding comes from the records themselves (Codex r11 on #610): held, committing and committed records hide their
    // "?" and an outing's trips; an abandoned one hides nothing, even while its deletion is still being tried.
    const read = () => {
      void readAnswersAfterCorrectionsWithState(who).then((records) => {
        const hiding = records.filter((each) => each.state !== "abandoned").map((each) => each.record);
        if (live) setWaiting({ key: ownerKey, ids: new Set(hiding.flatMap(answeredReviewItemIds)),
          segments: new Set(hiding.flatMap((record) => record.log ? [record.log.itemId] : [])) });
      }, () => undefined);
    };
    // The store's recovery runner, in front: on mount, and each return to the front. One given up here says so.
    const recover = () => {
      if (AppState.currentState !== "active") return;
      void recoverAnswersAfterCorrections(who).then(({ abandoned, abandonedReviewItemIds }) => {
        if (!live || !abandoned.length) return;
        if (abandonedReviewItemIds.length) droppedRef.current?.(abandonedReviewItemIds);
        // Through the one guarded notifier, checked now recovery has finished (its writes can be slow; Codex r12 and r15):
        // in front, this Dashboard still here, and still this account (the effect is this account's).
        sayIfStillHere({ inFront: () => AppState.currentState === "active", mounted: () => live, sameAccount: () => live }, () => {
          AccessibilityInfo.announceForAccessibility("The answer wasn’t saved. It is still here to check.");
          Alert.alert("Calendar", "Couldn’t save this answer on this iPhone.");
        });
      }, () => undefined);
    };
    let draining = false;
    let again = false;
    const drain = () => {
      if (draining) {
        again = true;
        return;
      }
      draining = true;
      void releaseAnswersAfterCorrections({ owner: who, readPending: readPendingTimelineCorrections,
        readAcknowledged: (owner) => readAcknowledgedTimelineCorrections(owner), release: releaseRef.current ?? viaReviewOutbox,
        onDropped: (record) => {
          const ids = answeredReviewItemIds(record);
          if (live && ids.length) droppedRef.current?.(ids);
        } })
        .catch(() => undefined)
        .finally(() => {
          draining = false;
          if (again && live) {
            again = false;
            drain();
          }
        });
    };
    read();
    drain();
    recover();
    const foreground = AppState.addEventListener("change", (state) => { if (state === "active") recover(); });
    const offAnswers = subscribeAnswersAfterCorrections(() => {
      read();
      drain();
    });
    const offCorrections = subscribeTimelineCorrectionOutbox(drain);
    return () => {
      live = false;
      offAnswers();
      offCorrections();
      foreground.remove();
    };
  }, [dataRead, userId, workspaceId]);
  const ids = waiting && waiting.key === key ? waiting.ids : NONE;
  const segments = waiting && waiting.key === key ? waiting.segments : NONE;
  // `waitingSegments`: places whose Logs as waits; their "?" stay out until it is sent (the server then closes them).
  return useMemo(() => ({ waitingIds: ids, waitingSegments: segments }), [ids, segments]);
}
