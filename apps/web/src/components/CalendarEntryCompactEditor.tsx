"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RecentActivitySuggestion } from "@dayframe/shared";
import type { CreateCategoryOutcome } from "@/components/CategoryPicker";
import {
  TimeEntryQuickEditorPanel,
  useTimeEntryQuickEditor,
  type TimeEntryQuickEditorProps
} from "@/components/TimeEntryQuickEditor";
import {
  calculateCalendarEditorPosition,
  calendarEditorRectIsVisible,
  type CalendarEditorPosition,
  type CalendarEntryCompactCreatePlan,
  type CalendarEntryCompactCreateSource,
  type CalendarEntryCompactSavePlan
} from "@/lib/calendar-entry-compact-editor";
import type { CategoryRow, TagRow, TimeEntryRow } from "@/lib/queries";

type MutationOutcome = { ok: true } | { ok: false; error: string };

type CalendarEntryCompactEditorSharedProps = {
  anchor: HTMLElement;
  capturedNow: Date;
  categories: CategoryRow[];
  focusOnOpen: boolean;
  isTimerBusy: boolean;
  onCreateCategory?: (name: string) => Promise<CreateCategoryOutcome>;
  onDismiss: (options: { restoreFocus: boolean }) => void;
  onOutsidePointerDown?: (pointer: { pointerId: number; pointerDownTimeStamp: number }) => void;
  peerEntries: TimeEntryRow[];
  positionKey: string;
  scrollContainer: HTMLElement | null;
  taskSuggestions?: RecentActivitySuggestion[];
  tags?: TagRow[];
};

type CalendarEntryCompactEditorProps = CalendarEntryCompactEditorSharedProps & (
  | {
      mode: "entry";
      entry: TimeEntryRow;
      onDelete: () => void;
      onSave: (plan: CalendarEntryCompactSavePlan) => Promise<MutationOutcome>;
      onStartAgain: () => Promise<MutationOutcome>;
    }
  | {
      mode: "create";
      source: CalendarEntryCompactCreateSource;
      onDraftChange: (plan: CalendarEntryCompactCreatePlan | null) => void;
      onSave: (plan: CalendarEntryCompactCreatePlan) => Promise<MutationOutcome>;
    }
);

export function CalendarEntryCompactEditor(props: CalendarEntryCompactEditorProps) {
  const {
    anchor,
    focusOnOpen,
    onOutsidePointerDown,
    positionKey,
    scrollContainer
  } = props;
  const editorProps = { ...props, tags: props.tags ?? [] } as TimeEntryQuickEditorProps;
  const controller = useTimeEntryQuickEditor(editorProps);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const attemptDismissRef = useRef(controller.attemptDismiss);
  const anchorVisibilityDismissRequestedRef = useRef(false);
  const [position, setPosition] = useState<CalendarEditorPosition | null>(null);

  useLayoutEffect(() => {
    attemptDismissRef.current = controller.attemptDismiss;
  }, [controller.attemptDismiss]);

  const updatePosition = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (!anchor.isConnected) {
      if (!anchorVisibilityDismissRequestedRef.current) {
        anchorVisibilityDismissRequestedRef.current = true;
        attemptDismissRef.current(false);
      }
      return;
    }
    const visualViewport = window.visualViewport;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportWidth = visualViewport?.width ?? window.innerWidth;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;
    const anchorRect = anchor.getBoundingClientRect();
    const scrollerRect = scrollContainer?.getBoundingClientRect() ?? null;
    const viewportRect = {
      bottom: viewportTop + viewportHeight,
      left: viewportLeft,
      right: viewportLeft + viewportWidth,
      top: viewportTop
    };
    if (!calendarEditorRectIsVisible(anchorRect, viewportRect, scrollerRect)) {
      if (!anchorVisibilityDismissRequestedRef.current) {
        anchorVisibilityDismissRequestedRef.current = true;
        attemptDismissRef.current(false);
      }
      return;
    }
    anchorVisibilityDismissRequestedRef.current = false;
    const panelRect = surface.getBoundingClientRect();
    const next = calculateCalendarEditorPosition({
      anchor: {
        bottom: anchorRect.bottom - viewportTop,
        height: anchorRect.height,
        left: anchorRect.left - viewportLeft,
        right: anchorRect.right - viewportLeft,
        top: anchorRect.top - viewportTop,
        width: anchorRect.width
      },
      panelHeight: panelRect.height,
      panelWidth: panelRect.width || 420,
      viewportHeight,
      viewportWidth
    });
    setPosition({ ...next, left: next.left + viewportLeft, top: next.top + viewportTop });
  }, [anchor, scrollContainer]);

  useLayoutEffect(() => {
    updatePosition();
    const surface = surfaceRef.current;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    observer?.observe(anchor);
    if (surface) observer?.observe(surface);
    if (scrollContainer) observer?.observe(scrollContainer);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [anchor, positionKey, scrollContainer, updatePosition]);

  useEffect(() => {
    if (!focusOnOpen) return;
    const frame = window.requestAnimationFrame(() => controller.descriptionRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [controller.descriptionRef, focusOnOpen]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const surface = surfaceRef.current;
      if (!surface) return;
      const path = event.composedPath();
      if (
        path.includes(surface) ||
        path.some((target) => target instanceof HTMLElement && target.classList.contains("time-entry-quick-editor-nested-surface"))
      ) return;
      const pointerIsOnAnchor = path.includes(anchor);
      if (!pointerIsOnAnchor) {
        onOutsidePointerDown?.({ pointerId: event.pointerId, pointerDownTimeStamp: event.timeStamp });
      }
      if (controller.isBusy) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (pointerIsOnAnchor) return;
      if (controller.hasUnsavedChanges) {
        event.preventDefault();
        event.stopPropagation();
      }
      controller.attemptDismiss(false);
    };
    const timeout = window.setTimeout(() => document.addEventListener("pointerdown", handlePointerDown, true), 0);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [anchor, controller, onOutsidePointerDown]);

  useEffect(() => {
    const blockNavigationWhileOwned = (event: KeyboardEvent) => {
      if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      if (controller.isBusy || controller.hasUnsavedChanges) {
        event.preventDefault();
        event.stopPropagation();
        controller.attemptDismiss(false);
      }
    };
    document.addEventListener("keydown", blockNavigationWhileOwned);
    return () => document.removeEventListener("keydown", blockNavigationWhileOwned);
  }, [controller]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={surfaceRef}
      className={[
        "calendar-compact-editor",
        controller.isEntered ? "is-entered" : "",
        controller.isExiting ? "is-exiting" : "",
        position?.placement === "above" ? "is-above" : "",
        position?.placement === "phone" ? "is-phone" : ""
      ].join(" ")}
      data-testid="calendar-compact-editor"
      aria-busy={controller.isBusy || undefined}
      style={{
        left: position?.left ?? 12,
        maxHeight: position?.maxHeight,
        top: position?.top ?? 12,
        visibility: position ? "visible" : "hidden",
        width: position?.width
      } as CSSProperties}
    >
      <TimeEntryQuickEditorPanel controller={controller} props={editorProps} surface="anchored" />
    </div>,
    document.body
  );
}
