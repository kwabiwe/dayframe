"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import type { TimelineView } from "@/lib/timeline-view";

/**
 * Calendar v3 (owner, 24 Oct 2026): one round button showing the current view's icon. It opens a small
 * menu, as Apple Calendar's does, with exactly two choices — the Calendar grid and List — each with its
 * icon and a check on the current one (no Multi Day). The web keeps "Calendar" for the grid because its
 * Day / Week scope sits beside it.
 *
 * Motion contract (.codex/reference/motion.md, "Web Reports range menu", reused): one owner, this
 * component's `menu` state. Entrance: opacity 0 → 1 over 120ms (phones: the bottom sheet rises 8 px).
 * Exit: "closing" keeps it mounted while it fades out over 120ms, then unmounts on animationend (timer
 * fallback). Reopening mid-exit returns to "open". Reduce Motion: no animation. The trigger never moves.
 *
 * The menu is portalled to <body> (the Calendar surface isolates its stacking, so a sheet inside it would
 * sit under the phone tab bar): fixed under the trigger's right edge on wider screens, a bottom sheet on
 * phones (the shared range-menu CSS).
 *
 * Keyboard (menu pattern): opening focuses the checked item; Up/Down move with wrap, Home/End jump;
 * Escape closes and returns focus to the trigger; Tab closes.
 */
type MenuState = "closed" | "open" | "closing";
const EXIT_MS = 120;
const VIEWS: ReadonlyArray<{ id: TimelineView; label: string; glyph: "calendar-days" | "list" }> = [
  { id: "calendar", label: "Calendar", glyph: "calendar-days" },
  { id: "list", label: "List", glyph: "list" }
];

function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function CalendarViewMenu({
  disabled,
  onChange,
  value
}: {
  disabled?: boolean;
  onChange: (view: TimelineView) => void;
  value: TimelineView;
}) {
  const [menu, setMenu] = useState<MenuState>("closed");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOpen = menu === "open";
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const current = VIEWS.find((view) => view.id === value) ?? VIEWS[0];

  function clearExitTimer() {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = null;
  }

  function closeMenu({ restoreFocus = false }: { restoreFocus?: boolean } = {}) {
    clearExitTimer();
    if (prefersReducedMotion()) {
      setMenu("closed");
    } else {
      setMenu((state) => (state === "closed" ? state : "closing"));
      exitTimer.current = setTimeout(() => setMenu((state) => (state === "closing" ? "closed" : state)), EXIT_MS + 80);
    }
    if (restoreFocus) triggerRef.current?.focus();
  }

  function items() {
    return Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? []);
  }

  useEffect(() => clearExitTimer, []);

  // Where the portalled menu sits on wider screens: under the trigger, flush with its right edge.
  useLayoutEffect(() => {
    if (menu === "closed") return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setAnchor({ top: rect.bottom + 6, right: Math.max(12, window.innerWidth - rect.right) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [menu]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu();
    };
    document.addEventListener("pointerdown", onPointer);
    const all = items();
    (all.find((item) => item.getAttribute("aria-checked") === "true") ?? all[0])?.focus();
    return () => document.removeEventListener("pointerdown", onPointer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      all[(next + all.length) % all.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index < 0 ? all.length - 1 : index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(all.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
    } else if (event.key === "Tab") {
      // The closing menu is inert, so focus goes back to the trigger now rather than to <body>.
      event.preventDefault();
      closeMenu({ restoreFocus: true });
    }
  }

  return (
    <div className="df-range-menu-wrap df-cal-view-wrap" ref={wrapRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`Calendar view: ${current.label}. Change view`}
        className="df-cal-view-trigger"
        disabled={disabled}
        onClick={() => {
          if (isOpen) {
            closeMenu();
          } else {
            clearExitTimer();
            setMenu("open");
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <DayframeIcon glyph={current.glyph} size={20} />
      </button>
      {menu !== "closed" && typeof document !== "undefined" ? createPortal(
        <div
          aria-label="Choose a view"
          className={`df-range-menu df-cal-view-menu${menu === "closing" ? " is-closing" : ""}`}
          data-state={menu}
          inert={menu === "closing" ? true : undefined}
          onAnimationEnd={(event) => {
            if (event.animationName === "df-range-menu-out") {
              clearExitTimer();
              setMenu((state) => (state === "closing" ? "closed" : state));
            }
          }}
          onKeyDown={onMenuKeyDown}
          ref={menuRef}
          role="menu"
          style={anchor ? ({ "--df-cal-view-top": `${anchor.top}px`, "--df-cal-view-right": `${anchor.right}px` } as CSSProperties) : undefined}
        >
          <button aria-label="Close views" className="df-range-menu-close" onClick={() => closeMenu({ restoreFocus: true })} tabIndex={-1} type="button">
            <X aria-hidden="true" size={20} />
          </button>
          <div aria-hidden="true" className="df-range-menu-head" role="presentation">View</div>
          {VIEWS.map((view) => (
            <button
              aria-checked={view.id === value}
              key={view.id}
              onClick={() => {
                closeMenu({ restoreFocus: true });
                if (view.id !== value) onChange(view.id);
              }}
              role="menuitemradio"
              type="button"
            >
              <span className="df-cal-view-item">
                <DayframeIcon glyph={view.glyph} size={18} />
                <span>{view.label}</span>
              </span>
              {view.id === value ? <Check aria-hidden="true" size={16} /> : null}
            </button>
          ))}
        </div>,
        document.body
      ) : null}
    </div>
  );
}
