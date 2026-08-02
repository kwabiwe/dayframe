"use client";

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Play, Trash2, X } from "lucide-react";
import { OverlapNotice } from "@/components/OverlapNotice";
import {
  buildCalendarEntryCompactSavePlan,
  calculateCalendarEditorPosition,
  calendarEditorPointerIsInside,
  calendarEditorRectIsVisible,
  calendarEntryCompactInitialDraft,
  emptyCalendarEntryCompactDirty,
  type CalendarEditorPosition,
  type CalendarEntryCompactDirty,
  type CalendarEntryCompactDraft,
  type CalendarEntryCompactSavePlan
} from "@/lib/calendar-entry-compact-editor";
import { maskTimeInput } from "@/lib/calendar-grid";
import { dateTimeLocal, formatClockDuration, formatDate } from "@/lib/format";
import type { CategoryRow, TimeEntryRow } from "@/lib/queries";

type MutationOutcome = { ok: true } | { ok: false; error: string };

export function CalendarEntryCompactEditor({
  anchor,
  capturedNow,
  categories,
  entry,
  focusOnOpen,
  isTimerBusy,
  onDelete,
  onDismiss,
  onSave,
  onStartAgain,
  peerEntries,
  positionKey,
  scrollContainer
}: {
  anchor: HTMLElement;
  capturedNow: Date;
  categories: CategoryRow[];
  entry: TimeEntryRow;
  focusOnOpen: boolean;
  isTimerBusy: boolean;
  onDelete: () => void;
  onDismiss: (options: { restoreFocus: boolean }) => void;
  onSave: (plan: CalendarEntryCompactSavePlan) => Promise<MutationOutcome>;
  onStartAgain: () => Promise<MutationOutcome>;
  peerEntries: TimeEntryRow[];
  positionKey: string;
  scrollContainer: HTMLElement | null;
}) {
  const [draft, setDraft] = useState<CalendarEntryCompactDraft>(() => calendarEntryCompactInitialDraft(entry));
  const [dirty, setDirty] = useState<CalendarEntryCompactDirty>(emptyCalendarEntryCompactDirty);
  const [error, setError] = useState<string | null>(null);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [categoryIndex, setCategoryIndex] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [isEntered, setIsEntered] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [now, setNow] = useState(capturedNow);
  const [position, setPosition] = useState<CalendarEditorPosition | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const descriptionRef = useRef<HTMLInputElement | null>(null);
  const categoryButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeTokenRef = useRef(0);
  const exitTimeoutRef = useRef<number | null>(null);
  const selectedCategory = categories.find((category) => category.id === draft.categoryId) ?? null;
  const categoryOptions = useMemo(() => [null, ...categories] as Array<CategoryRow | null>, [categories]);
  const preview = useMemo(() => {
    try {
      return {
        error: null,
        plan: buildCalendarEntryCompactSavePlan({ draft, dirty, entry, now })
      };
    } catch (previewError) {
      return {
        error: previewError instanceof Error ? previewError.message : "Check the time values.",
        plan: null
      };
    }
  }, [dirty, draft, entry, now]);

  const updateField = useCallback(<Key extends keyof CalendarEntryCompactDraft,>(
    key: Key,
    value: CalendarEntryCompactDraft[Key]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty((current) => ({ ...current, [key]: true }));
    setError(null);
  }, []);

  const finishDismiss = useCallback((restoreFocus: boolean) => {
    if (exitTimeoutRef.current !== null) {
      window.clearTimeout(exitTimeoutRef.current);
      exitTimeoutRef.current = null;
    }
    closeTokenRef.current += 1;
    onDismiss({ restoreFocus });
  }, [onDismiss]);

  const requestDismiss = useCallback((restoreFocus: boolean) => {
    if (isBusy) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      finishDismiss(restoreFocus);
      return;
    }
    const token = ++closeTokenRef.current;
    setIsExiting(true);
    if (exitTimeoutRef.current !== null) window.clearTimeout(exitTimeoutRef.current);
    exitTimeoutRef.current = window.setTimeout(() => {
      exitTimeoutRef.current = null;
      if (closeTokenRef.current === token) onDismiss({ restoreFocus });
    }, 90);
  }, [finishDismiss, isBusy, onDismiss]);

  useEffect(() => () => {
    closeTokenRef.current += 1;
    if (exitTimeoutRef.current !== null) window.clearTimeout(exitTimeoutRef.current);
  }, []);

  const updatePosition = useCallback(() => {
    const panel = panelRef.current;
    if (!panel || !anchor.isConnected) {
      finishDismiss(false);
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
      finishDismiss(false);
      return;
    }
    const panelRect = panel.getBoundingClientRect();
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
      panelWidth: panelRect.width || 360,
      viewportHeight,
      viewportWidth
    });
    setPosition({ ...next, left: next.left + viewportLeft, top: next.top + viewportTop });
  }, [anchor, finishDismiss, scrollContainer]);

  useLayoutEffect(() => {
    updatePosition();
    const panel = panelRef.current;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(updatePosition);
    observer?.observe(anchor);
    if (panel) observer?.observe(panel);
    if (scrollContainer) observer?.observe(scrollContainer);
    mutationObserver?.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      observer?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [anchor, positionKey, scrollContainer, updatePosition]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setIsEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!focusOnOpen) return;
    const frame = window.requestAnimationFrame(() => descriptionRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [focusOnOpen]);

  useEffect(() => {
    if (entry.stoppedAt) return undefined;
    const interval = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(interval);
  }, [entry.stoppedAt]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const panel = panelRef.current;
      if (isBusy || !panel || calendarEditorPointerIsInside(event.composedPath(), panel, anchor)) return;
      finishDismiss(false);
    };
    const timeout = window.setTimeout(() => {
      document.addEventListener("pointerdown", handlePointerDown, true);
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [anchor, finishDismiss, isBusy]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isCategoryOpen) {
        event.preventDefault();
        setIsCategoryOpen(false);
        categoryButtonRef.current?.focus();
        return;
      }
      event.preventDefault();
      requestDismiss(true);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isCategoryOpen, requestDismiss]);

  async function save() {
    if (isBusy) return;
    if (!preview.plan) {
      setError(preview.error);
      return;
    }
    if (Object.keys(preview.plan.payload).length === 0) {
      finishDismiss(true);
      return;
    }
    setIsBusy(true);
    setError(null);
    const outcome = await onSave(preview.plan);
    if (!outcome.ok) {
      setError(outcome.error);
      setIsBusy(false);
      return;
    }
    finishDismiss(true);
  }

  async function startAgain() {
    if (isBusy || isTimerBusy) return;
    setIsBusy(true);
    setError(null);
    const outcome = await onStartAgain();
    if (!outcome.ok) {
      setError(outcome.error);
      setIsBusy(false);
      return;
    }
    finishDismiss(false);
  }

  function openCategoryMenu() {
    const selectedIndex = categoryOptions.findIndex((category) => (category?.id ?? "") === draft.categoryId);
    setCategoryIndex(Math.max(0, selectedIndex));
    setIsCategoryOpen((open) => !open);
  }

  function handleCategoryKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setCategoryIndex((current) => (current + direction + categoryOptions.length) % categoryOptions.length);
      setIsCategoryOpen(true);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setCategoryIndex(event.key === "Home" ? 0 : categoryOptions.length - 1);
      setIsCategoryOpen(true);
    } else if (event.key === "Enter" && isCategoryOpen) {
      event.preventDefault();
      const category = categoryOptions[categoryIndex];
      updateField("categoryId", category?.id ?? "");
      setIsCategoryOpen(false);
    }
  }

  const title = entry.description?.trim() || entry.categoryName?.trim() || "Untitled entry";
  const datesDiffer = entry.stoppedAt
    ? dateTimeLocal(entry.startedAt).slice(0, 10) !== dateTimeLocal(entry.stoppedAt).slice(0, 10)
    : false;
  const displayError = error ?? preview.error;

  return createPortal(
    <div
      ref={panelRef}
      className={[
        "calendar-compact-editor",
        isEntered ? "is-entered" : "",
        isExiting ? "is-exiting" : "",
        position?.placement === "above" ? "is-above" : "",
        position?.placement === "phone" ? "is-phone" : ""
      ].join(" ")}
      data-testid="calendar-compact-editor"
      role="dialog"
      aria-label={`Edit ${title}`}
      aria-modal="false"
      style={{
        left: position?.left ?? 12,
        maxHeight: position?.maxHeight,
        top: position?.top ?? 12,
        visibility: position ? "visible" : "hidden",
        width: position?.width
      } as CSSProperties}
    >
      <div className="calendar-compact-editor-header">
        <div>
          <span className="calendar-compact-editor-kicker">Calendar entry</span>
          <strong>{title}</strong>
        </div>
        <div className="calendar-compact-editor-icons">
          {entry.stoppedAt ? (
            <button
              className="calendar-compact-icon-action"
              type="button"
              aria-label={`Start ${title} again`}
              disabled={isBusy || isTimerBusy}
              onClick={() => void startAgain()}
            >
              <Play size={16} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          ) : null}
          <button className="calendar-compact-icon-action is-danger" type="button" aria-label={`Delete ${title}`} disabled={isBusy} onClick={onDelete}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
          <button className="calendar-compact-icon-action" type="button" aria-label="Close editor" disabled={isBusy} onClick={() => requestDismiss(true)}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="calendar-compact-editor-fields">
        <label className="calendar-compact-editor-description">
          <span>Description</span>
          <input
            ref={descriptionRef}
            type="text"
            value={draft.description}
            placeholder="What are you working on?"
            disabled={isBusy}
            onChange={(event) => updateField("description", event.target.value)}
          />
        </label>

        <div className="calendar-compact-category-field">
          <span className="calendar-compact-field-label">Category</span>
          <button
            ref={categoryButtonRef}
            type="button"
            aria-expanded={isCategoryOpen}
            aria-haspopup="listbox"
            disabled={isBusy}
            onClick={openCategoryMenu}
            onKeyDown={handleCategoryKeyDown}
          >
            <span
              className="calendar-compact-category-dot"
              style={{ background: selectedCategory?.color ?? "var(--muted)" }}
              aria-hidden="true"
            />
            <span>{selectedCategory?.name ?? "No category"}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          {isCategoryOpen ? (
            <div className="calendar-compact-category-menu" role="listbox" aria-label="Categories">
              {categoryOptions.map((category, index) => {
                const value = category?.id ?? "";
                const selected = value === draft.categoryId;
                return (
                  <button
                    key={category?.id ?? "no-category"}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={index === categoryIndex ? "is-active" : ""}
                    onMouseEnter={() => setCategoryIndex(index)}
                    onClick={() => {
                      updateField("categoryId", value);
                      setIsCategoryOpen(false);
                      categoryButtonRef.current?.focus();
                    }}
                  >
                    <span
                      className="calendar-compact-category-dot"
                      style={{ background: category?.color ?? "var(--muted)" }}
                      aria-hidden="true"
                    />
                    <span>{category?.name ?? "No category"}</span>
                    {selected ? <Check size={15} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="calendar-compact-time-row">
          <label>
            <span>Start</span>
            <input
              inputMode="numeric"
              type="text"
              value={draft.startedAt}
              placeholder="08:30"
              disabled={isBusy}
              onChange={(event) => updateField("startedAt", maskTimeInput(event.target.value))}
            />
          </label>
          {entry.stoppedAt ? (
            <label>
              <span>Finish</span>
              <input
                inputMode="numeric"
                type="text"
                value={draft.stoppedAt}
                placeholder="09:15"
                disabled={isBusy}
                onChange={(event) => updateField("stoppedAt", maskTimeInput(event.target.value))}
              />
            </label>
          ) : null}
          <div className="calendar-compact-duration" aria-label={entry.stoppedAt ? "Duration" : "Elapsed time"}>
            <span>{entry.stoppedAt ? "Duration" : "Elapsed"}</span>
            <strong className="tabular">{preview.plan ? formatClockDuration(preview.plan.durationSeconds) : "—"}</strong>
          </div>
        </div>
        {datesDiffer ? (
          <p className="calendar-compact-date-context">
            Start {formatDate(entry.startedAt)} · Finish {formatDate(entry.stoppedAt as string)}
          </p>
        ) : null}
      </div>

      {preview.plan ? (
        <OverlapNotice
          compact
          candidate={{
            startedAt: preview.plan.resolved.startedAt,
            stoppedAt: preview.plan.resolved.stoppedAt
          }}
          entries={peerEntries}
          excludeEntryId={entry.id}
        />
      ) : null}

      {displayError ? <p className="calendar-compact-editor-error" role="alert">{displayError}</p> : null}

      <div className="calendar-compact-editor-footer">
        <span>{entry.stoppedAt ? "Times use this entry’s original dates." : "Running timer"}</span>
        <button type="button" className="calendar-compact-save" disabled={isBusy} onClick={() => void save()}>
          Save
        </button>
      </div>
    </div>,
    document.body
  );
}
