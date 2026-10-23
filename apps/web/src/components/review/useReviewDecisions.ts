import { useCallback, useEffect, useState } from "react";
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
  applyRestore?: (update: () => void) => void
) {
  const [state, setState] = useState<ReviewDecisionState>(initialReviewDecisionState);
  const [controller] = useState(() => {
    let restoredSequence = 0;
    return new ReviewDecisionController((next) => {
      const restoring = next.restored !== null && next.restored.sequence !== restoredSequence;
      if (next.restored) restoredSequence = next.restored.sequence;
      if (restoring && applyRestore) applyRestore(() => setState(next));
      else setState(next);
    });
  });
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
      if (!response.ok) {
        const message = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : null;
        throw new Error(message ?? "Couldn’t save that decision.");
      }
      if (!validReviewAcknowledgement(body, envelope, decision.itemId)) {
        throw new Error("Couldn’t confirm that decision was saved.");
      }
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
    clearError: useCallback(() => controller.clearError(), [controller])
  };
}
