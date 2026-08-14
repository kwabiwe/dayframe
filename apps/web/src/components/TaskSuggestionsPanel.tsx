"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { RecentActivitySuggestion } from "@dayframe/shared";
import { paletteCssColorFor } from "@dayframe/shared";
import { Play } from "lucide-react";

export function TaskSuggestionsPanel({
  anchorRef,
  isBusy,
  isOpen,
  onSelect,
  panelRef,
  portal = false,
  suggestions
}: {
  anchorRef?: RefObject<HTMLElement | null>;
  isBusy: boolean;
  isOpen: boolean;
  onSelect: (suggestion: RecentActivitySuggestion) => void;
  panelRef?: RefObject<HTMLDivElement | null>;
  portal?: boolean;
  suggestions: RecentActivitySuggestion[];
}) {
  const internalPanelRef = useRef<HTMLDivElement | null>(null);
  const resolvedPanelRef = panelRef ?? internalPanelRef;
  const [portalPosition, setPortalPosition] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!isOpen || !portal) return undefined;

    function updatePosition() {
      const anchor = anchorRef?.current;
      const panel = resolvedPanelRef.current;
      if (!anchor || !panel) return;
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const margin = 12;
      const gap = 6;
      const anchorRect = anchor.getBoundingClientRect();
      const availableWidth = Math.max(0, viewportWidth - margin * 2);
      const width = Math.min(anchorRect.width, availableWidth);
      const left = Math.min(
        Math.max(viewportLeft + margin, anchorRect.left),
        Math.max(viewportLeft + margin, viewportLeft + viewportWidth - width - margin)
      );
      const belowTop = anchorRect.bottom + gap;
      const belowSpace = viewportTop + viewportHeight - margin - belowTop;
      const aboveSpace = anchorRect.top - gap - (viewportTop + margin);
      const contentHeight = Math.min(panel.scrollHeight || panel.getBoundingClientRect().height, 322);
      const placeBelow = contentHeight <= belowSpace || belowSpace >= aboveSpace;
      const availableHeight = Math.max(0, placeBelow ? belowSpace : aboveSpace);
      const maxHeight = Math.min(322, availableHeight);
      const renderedHeight = Math.min(contentHeight, maxHeight);
      const top = placeBelow
        ? belowTop
        : Math.max(viewportTop + margin, anchorRect.top - gap - renderedHeight);

      setPortalPosition({
        bottom: "auto",
        left,
        maxHeight,
        right: "auto",
        top,
        width
      });
    }

    updatePosition();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    if (anchorRef?.current) observer?.observe(anchorRef.current);
    if (resolvedPanelRef.current) observer?.observe(resolvedPanelRef.current);
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
  }, [anchorRef, isOpen, portal, resolvedPanelRef]);

  const panel = (
    <div
      aria-hidden={!isOpen}
      aria-label="Suggestions"
      className={`ui-floating-surface swiss-task-suggestions${isOpen ? " is-open" : ""}${portal ? " is-portalled time-entry-quick-editor-nested-surface" : ""}`}
      inert={!isOpen}
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')];
        if (!options.length) return;
        event.preventDefault();
        const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : event.key === "ArrowUp"
              ? (currentIndex - 1 + options.length) % options.length
              : (currentIndex + 1) % options.length;
        options[nextIndex]?.focus();
      }}
      ref={resolvedPanelRef}
      role="listbox"
      style={portal ? { ...portalPosition, visibility: portalPosition ? "visible" : "hidden" } : undefined}
    >
      <div className="swiss-task-suggestions-header"><span>Suggestions</span></div>
      <div className="swiss-task-suggestions-list">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.key}
            type="button"
            role="option"
            aria-selected={false}
            disabled={isBusy}
            onClick={() => onSelect(suggestion)}
          >
            <span>
              <b>{suggestion.description}</b>
              <small>
                <i style={{ backgroundColor: paletteCssColorFor(suggestion.categoryColor ?? "steel", suggestion.categoryName ?? "Category") }} />
                {suggestion.categoryName ?? "Uncategorized"}
                {suggestion.tagNames.length ? ` · ${suggestion.tagNames.map((tag) => `#${tag}`).join(" ")}` : ""}
              </small>
            </span>
            <Play size={14} fill="currentColor" strokeWidth={0} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );

  return portal && typeof document !== "undefined" ? createPortal(panel, document.body) : panel;
}
