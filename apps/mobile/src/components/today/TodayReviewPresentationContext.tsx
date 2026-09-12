import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo } from "react-native";
import { router } from "expo-router";
import type { MobileBootstrap, MobileTimeEntry } from "@/lib/api";
import { saveQuickReviewConfirmation } from "@/lib/reviewQuickConfirm";
import { todayReviewNavigationTarget } from "@/lib/todayReviewNavigation";
import type { TodayActivity } from "@/lib/todayReviewPresentation";
import {
  useTodayReviewPresentation,
  type TodayReviewPresentationState
} from "./useTodayReviewPresentation";

type TodayReviewContextValue = TodayReviewPresentationState & {
  isSummaryAvailable: boolean;
  isCommitting: (reviewItemId: string) => boolean;
  messageFor: (reviewItemId: string) => string | null;
  openActivity: (activity: TodayActivity) => void;
  openReview: () => void;
  quickConfirm: (activity: TodayActivity) => void;
};

const TodayReviewContext = createContext<TodayReviewContextValue | null>(null);

export function TodayReviewPresentationProvider({
  bootstrap,
  children,
  dashboardEntries,
  isFocused,
  nowMs
}: {
  bootstrap: MobileBootstrap | null;
  children: ReactNode;
  dashboardEntries: readonly MobileTimeEntry[];
  isFocused: boolean;
  nowMs: number;
}) {
  const state = useTodayReviewPresentation({ bootstrap, dashboardEntries, isFocused, nowMs });
  const [committingIds, setCommittingIds] = useState<Set<string>>(() => new Set());
  const [messages, setMessages] = useState<Map<string, string>>(() => new Map());
  const isSummaryAvailable = Boolean(state.presentation && state.presentation.coverage !== "unavailable");

  const openReview = useCallback(() => {
    router.push("/review");
  }, []);

  const openActivity = useCallback((activity: TodayActivity) => {
    const target = todayReviewNavigationTarget(activity);
    if (!target) return;
    if (target.kind === "canonical_entry") return;
    router.push({ pathname: target.pathname, params: target.params } as never);
  }, []);

  const quickConfirm = useCallback((activity: TodayActivity) => {
    if (
      activity.source.kind !== "review" ||
      !activity.quickConfirm.eligible ||
      !state.owner ||
      !state.snapshot
    ) return;
    const mutation = activity.quickConfirm.mutation;
    if (mutation.action !== "accept" && mutation.action !== "confirm") return;
    const expectedProposalHash = mutation.expectedProposalHash;
    if (!expectedProposalHash) return;
    const reviewItemId = activity.source.reviewItemId;
    setCommittingIds((current) => new Set(current).add(reviewItemId));
    setMessages((current) => {
      const next = new Map(current);
      next.delete(reviewItemId);
      return next;
    });
    void saveQuickReviewConfirmation({
      owner: state.owner,
      response: state.snapshot.response,
      reviewItemId,
      proposalHash: expectedProposalHash,
      onCommitted: () => {
        AccessibilityInfo.announceForAccessibility(
          "Saved on this iPhone. Confirmation will sync."
        );
      }
    }).then((result) => {
      if (!result.saved) {
        setMessages((current) => new Map(current).set(
          reviewItemId,
          "This confirmation is already being saved on this iPhone."
        ));
      }
    }).catch(() => {
      // This is deliberately a local-persistence error, not a transport
      // status. The existing source stays visible and usable.
      setMessages((current) => new Map(current).set(
        reviewItemId,
        "The confirmation was not saved on this iPhone. Try again."
      ));
      AccessibilityInfo.announceForAccessibility(
        "The confirmation was not saved. The Review proposal is still available."
      );
    }).finally(() => {
      setCommittingIds((current) => {
        const next = new Set(current);
        next.delete(reviewItemId);
        return next;
      });
    });
  }, [state.owner, state.snapshot]);

  const value = useMemo<TodayReviewContextValue>(() => ({
    ...state,
    isSummaryAvailable,
    isCommitting: (reviewItemId) => committingIds.has(reviewItemId),
    messageFor: (reviewItemId) => messages.get(reviewItemId) ?? null,
    openActivity,
    openReview,
    quickConfirm
  }), [committingIds, isSummaryAvailable, messages, openActivity, openReview, quickConfirm, state]);

  return <TodayReviewContext.Provider value={value}>{children}</TodayReviewContext.Provider>;
}

export function useTodayReviewPresentationContext() {
  return useContext(TodayReviewContext);
}
