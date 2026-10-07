import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { MobileBootstrap, MobileTimeEntry } from "@/lib/api";
import {
  useTodayReviewPresentation,
  type TodayReviewPresentationState
} from "./useTodayReviewPresentation";

// Today reads the Review presentation only for its nudge (count and colours). Confirming happens in
// Review; Quick Confirm left Today with the Blocks prototype (owner, 7 October 2026).
type TodayReviewContextValue = TodayReviewPresentationState & {
  isSummaryAvailable: boolean;
};

const TodayReviewContext = createContext<TodayReviewContextValue | null>(null);

export function TodayReviewPresentationProvider({
  bootstrap,
  children,
  dashboardEntries,
  manualProjectedEntries,
  isFocused,
  nowMs,
  refreshGeneration
}: {
  bootstrap: MobileBootstrap | null;
  children: ReactNode;
  dashboardEntries: readonly MobileTimeEntry[];
  manualProjectedEntries: readonly MobileTimeEntry[];
  isFocused: boolean;
  nowMs: number;
  refreshGeneration?: number;
}) {
  const state = useTodayReviewPresentation({
    bootstrap,
    dashboardEntries,
    manualProjectedEntries,
    isFocused,
    nowMs,
    refreshGeneration
  });
  const isSummaryAvailable = Boolean(state.presentation && state.presentation.coverage !== "unavailable");
  const value = useMemo<TodayReviewContextValue>(
    () => ({ ...state, isSummaryAvailable }),
    [isSummaryAvailable, state]
  );

  return <TodayReviewContext.Provider value={value}>{children}</TodayReviewContext.Provider>;
}

export function useTodayReviewPresentationContext() {
  return useContext(TodayReviewContext);
}
