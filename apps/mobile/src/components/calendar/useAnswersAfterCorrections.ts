import { useEffect, useMemo, useRef, useState } from "react";
import type { MobileBootstrap } from "../../lib/api";
import type { MobileAccountOwner } from "../../lib/mobileAccount";
import { isOpenReviewItem } from "../../lib/review";
import { reviewAnswerMutation } from "../../lib/reviewAnswer";
import { reviewAnswersDecided } from "../../lib/reviewAnswerClaims";
import {
  readAnswersAfterCorrections,
  releaseAnswersAfterCorrections,
  subscribeAnswersAfterCorrections,
  type AnswerAfterCorrectionsRelease
} from "../../lib/reviewAnswersAfterCorrections";
import { enqueueReviewMutation, synchroniseReviewMutations } from "../../lib/reviewSyncStore";
import { readPendingTimelineCorrections, subscribeTimelineCorrectionOutbox } from "../../lib/timelineCorrectionOutbox";

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
  /** A waiting answer dropped (its change refused): its "?" is shown again at once (Codex r3 on #610). */
  onDropped?: (reviewItemId: string) => void;
  owner: MobileAccountOwner | null;
  /** Tests: what a release does (the Review outbox otherwise). */
  release?: AnswerAfterCorrectionsRelease;
}) {
  const userId = owner?.userId ?? null;
  const workspaceId = owner?.workspaceId ?? null;
  const key = userId && workspaceId ? `${workspaceId}:${userId}` : null;
  const [waiting, setWaiting] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null);
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
      const bootstrap = dataRef.current;
      if (!bootstrap || bootstrap.user.id !== who.userId || bootstrap.workspace.id !== who.workspaceId) return "wait";
      const item = bootstrap.reviewItems.find((each) => each.id === record.reviewItemId);
      if (!item) return "wait";
      if (!isOpenReviewItem(item)) return "gone";
      // Decided meanwhile on this phone (the deck): not this answer's to save.
      if ((await reviewAnswersDecided(bootstrap, [item.id])).size) return "gone";
      await enqueueReviewMutation({ bootstrap, item, mutation: reviewAnswerMutation(item, record.logged), clientMutationId: record.id });
      void synchroniseReviewMutations().catch(() => undefined);
      return "released";
    };
    const read = () => {
      void readAnswersAfterCorrections(who).then((records) => {
        if (live) setWaiting({ key: ownerKey, ids: new Set(records.map((record) => record.reviewItemId)) });
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
      void releaseAnswersAfterCorrections({ owner: who, readPending: readPendingTimelineCorrections, release: releaseRef.current ?? viaReviewOutbox,
        onDropped: (record) => { if (live) droppedRef.current?.(record.reviewItemId); } })
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
    const offAnswers = subscribeAnswersAfterCorrections(() => {
      read();
      drain();
    });
    const offCorrections = subscribeTimelineCorrectionOutbox(drain);
    return () => {
      live = false;
      offAnswers();
      offCorrections();
    };
  }, [dataRead, userId, workspaceId]);
  const ids = waiting && waiting.key === key ? waiting.ids : NONE;
  return useMemo(() => ({ waitingIds: ids }), [ids]);
}
