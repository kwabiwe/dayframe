import { useCallback, useEffect, useRef, useState } from "react";
import { validReviewAcknowledgement, type ReviewMutationEnvelope } from "@dayframe/shared";
import { clientFetch } from "@/lib/client-auth-fetch";
import type { ReviewItemRow } from "@/lib/queries";
import { ReviewDecisionController, initialReviewDecisionState, type ReviewDecisionState } from "@/lib/review-decision-controller";
import { reviewProposalSignature } from "@/lib/review-deck";
import { onBeforeSessionChange } from "@/lib/session-change";

/**
 * Review decisions with Undo (moved out of ReviewDeck for the List's "?" answers, location v4 step 14):
 * each is held for a few seconds, then saved; a suggestion decided elsewhere or changed meanwhile is
 * dropped or brought back. The deck and Calendar › List share it, so an answer has the same effect.
 */
export function useReviewDecisions(
  openItems: readonly ReviewItemRow[], refresh: () => Promise<unknown>,
  onOutingConflict: (stayId: string, statuses: Record<string, string>) => void,
  /**
   * How a restore (Undo, or a refused save) reaches the page: the List runs it through its own
   * transition. Read once, when the controller is made: pass a stable function.
   */
  applyRestore?: (update: () => void) => void,
  /**
   * Whose decisions these are (workspace and user). Another owner starts a new controller with an empty state;
   * the previous one's held decision is sent at once, and anything it reports later (a save, a refusal, a
   * restore) is ignored, so it never shows in the next owner's lifetime (Codex r4 on #609).
   */
  owner = "",
  /**
   * What a saved answer's acknowledgement said (a block that ran into a trip reports `stoppedRunningTimer` when End it
   * stopped the running block, so the timer refreshes too). Read once, when the controller is made: pass a stable function.
   */
  onAcknowledged?: (body: Record<string, unknown>) => void
) {
  const [state, setState] = useState<ReviewDecisionState>(initialReviewDecisionState);
  const onAcknowledgedRef = useRef(onAcknowledged);
  // One controller per owner lifetime; a retired one's later reports are dropped.
  const make = (forOwner: string) => {
    let restoredSequence = 0;
    let active = true;
    const controller = new ReviewDecisionController((next) => {
      if (!active) return;
      const restoring = next.restored !== null && next.restored.sequence !== restoredSequence;
      if (next.restored) restoredSequence = next.restored.sequence;
      // The restore may run later (the List's transition): it applies only while this lifetime still is the current
      // one, and installs the controller's state as it is then — never the snapshot from when it was queued, so a
      // newer answer made meanwhile is kept (Codex r5, r6 on #609).
      if (restoring && applyRestore) applyRestore(() => { if (active) setState(controller.getState()); });
      else setState(next);
    });
    return { owner: forOwner, controller, activate: () => { active = true; }, retire: () => { active = false; } };
  };
  const [lifetime, setLifetime] = useState(() => make(owner));
  if (lifetime.owner !== owner) {
    // Another owner: the old controller is silenced at once (its held decision is still sent, below).
    lifetime.retire();
    setLifetime(make(owner));
    setState(initialReviewDecisionState);
  }
  const controller = lifetime.controller;
  useEffect(() => {
    lifetime.activate();
    return () => lifetime.retire();
  }, [lifetime]);
  // The save reads the newest data: a held suggestion a refresh changed is not what the user
  // decided about. One a refresh no longer lists (decided elsewhere, or past the newest 100) is
  // still sent, and the server says.
  useEffect(() => {
    const items = new Map(openItems.map((item) => [item.id, item]));
    controller.setCommit(async (decision, options) => {
      const current = items.get(decision.itemId);
      if (current && reviewProposalSignature(current) !== decision.signature) return "changed";
      const envelope: ReviewMutationEnvelope = { clientMutationId: decision.clientMutationId, mutation: decision.mutation };
      const response = await clientFetch(`/api/review/${decision.itemId}`, {
        body: JSON.stringify(envelope),
        headers: { "Content-Type": "application/json" },
        keepalive: options.keepalive,
        method: "POST"
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      // An outing that changed (one of its cards decided elsewhere or retired) saved nothing: its Stay
      // comes back with the reason, and the next data shows whatever is still open (Codex r1 on #466).
      const outingAction = decision.mutation.action === "confirm_outing" || decision.mutation.action === "ignore_outing";
      if (outingAction && response.status === 409 && body.code === "resolution_conflict") {
        void refresh().catch(() => undefined);
        // The server says which cards are still open (Codex r2 on #466): a Stay decided elsewhere is
        // gone (its open Moves then show on their own); otherwise the outing comes back, open cards only.
        const statuses = body.canonicalReviewStatuses && typeof body.canonicalReviewStatuses === "object"
          ? body.canonicalReviewStatuses as Record<string, string> : null;
        if (statuses) onOutingConflict(decision.itemId, statuses);
        if (statuses && statuses[decision.itemId] !== undefined && statuses[decision.itemId] !== "open") return "gone";
        return "changed";
      }
      // Decided elsewhere (another device or tab): nothing to save and nothing to bring back.
      if (
        response.status === 404 ||
        (response.status === 409 && body.code === "resolution_conflict") ||
        (response.ok && body.alreadyResolved === true)
      ) {
        void refresh().catch(() => undefined);
        return "gone";
      }
      // A question that changed before it was answered (a block that ran into a trip whose block or trip changed):
      // nothing saved; the day is read again and the question comes back as it is now (location v4 design §7).
      if (response.status === 409 && body.code === "proposal_changed") {
        void refresh().catch(() => undefined);
        return "changed";
      }
      if (!response.ok) {
        const message = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : null;
        throw new Error(message ?? "Couldn’t save that decision.");
      }
      if (!validReviewAcknowledgement(body, envelope, decision.itemId)) {
        throw new Error("Couldn’t confirm that decision was saved.");
      }
      onAcknowledgedRef.current?.(body);
      void refresh().catch(() => undefined);
      return "saved";
    });
  }, [controller, onOutingConflict, openItems, refresh]);

  useEffect(() => onBeforeSessionChange(() => controller.flushAndSettle()), [controller]);

  useEffect(() => {
    const flush = () => controller.flush();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      // Leaving Review saves a held decision at once (a remount after this keeps working).
      controller.flush();
    };
  }, [controller]);

  useEffect(() => {
    controller.reconcileItemIds(new Set(openItems.map((item) => item.id)));
  }, [controller, openItems]);

  return {
    state,
    decide: useCallback((request: Parameters<ReviewDecisionController["decide"]>[0]) => controller.decide(request), [controller]),
    undo: useCallback(() => controller.undo(), [controller]),
    /** Saves a held decision now and resolves once every save in flight has settled. */
    settle: useCallback(() => controller.flushAndSettle(), [controller]),
    /** Items the server resolved another way: their held or saving decisions can't be undone or restored. */
    settleResolved: useCallback((itemIds: Iterable<string>) => controller.settleResolved(itemIds), [controller]),
    clearError: useCallback(() => controller.clearError(), [controller])
  };
}
