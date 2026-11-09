"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const SHOW_DELAY_MS = 400;
const MARGIN = 8;
const GAP = 6;

type Tip = { text: string; left: number; top: number; placement: "above" | "below" };

/**
 * The one web tooltip (web UI audit WUI-014, owner 17 Oct 2026): any element with `data-tip` shows
 * that short text in an inverse pill after 400 ms of hover, or at once on keyboard focus, and hides
 * on leave, blur, Escape or a press; a scroll hides a hover tip and moves a focus tip with its
 * button. Icon-only buttons set it from their label (`IconButton`) or a short verb ("Edit", "Start
 * again"); the accessible name stays on the button, so the tip itself is hidden from assistive
 * technology. It is a manual popover in the top layer, fixed to the viewport and clamped inside it,
 * so no dialog covers it, no scrolling container clips it and it never widens the page.
 */
const QUIET_FOCUS_ATTRIBUTE = "data-tip-quiet";

/**
 * Gives focus back to `element` after an action finished (the running block's Split, owner 28 Oct 2026),
 * without its tip or a focus ring: the browser may count a programmatic focus as keyboard focus, and at
 * phone width the "…" tip would cover Stop. Keyboard focus that arrives later shows the tip as usual.
 */
export function focusQuietly(element: HTMLElement | null) {
  if (!element) return;
  element.setAttribute(QUIET_FOCUS_ATTRIBUTE, "");
  // Quiet until it loses focus or the keyboard is used: then its ring (and next time its tip) show as usual.
  const end = () => {
    element.removeAttribute(QUIET_FOCUS_ATTRIBUTE);
    element.removeEventListener("blur", end);
    document.removeEventListener("keydown", end, true);
  };
  element.addEventListener("blur", end);
  document.addEventListener("keydown", end, true);
  element.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
}

export function TooltipHost() {
  const [tip, setTip] = useState<Tip | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  // A keyboard-focus tip follows its button through a scroll (Tab often scrolls the button into
  // view); a hover tip hides, since the pointer is no longer over the same spot.
  const fromFocusRef = useRef(false);

  useEffect(() => {
    function clear() {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    let reposition: number | null = null;
    function hide() {
      clear();
      if (reposition !== null) window.cancelAnimationFrame(reposition);
      reposition = null;
      targetRef.current = null;
      fromFocusRef.current = false;
      setTip(null);
    }
    function onViewportChange() {
      const target = targetRef.current;
      if (!fromFocusRef.current || !target || target !== document.activeElement || !target.isConnected) {
        hide();
        return;
      }
      if (reposition !== null) return;
      reposition = window.requestAnimationFrame(() => {
        reposition = null;
        if (targetRef.current === target && document.activeElement === target) showFor(target);
      });
    }
    function showFor(target: HTMLElement) {
      const text = target.dataset.tip?.trim();
      if (!text) return;
      const rect = target.getBoundingClientRect();
      const placement = rect.top > 48 ? "above" : "below";
      targetRef.current = target;
      setTip({
        text,
        left: rect.left + rect.width / 2,
        top: placement === "above" ? rect.top - GAP : rect.bottom + GAP,
        placement
      });
    }
    function tipTarget(event: Event) {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tip]") : null;
      return element && !element.closest("[inert]") ? element : null;
    }
    function onPointerOver(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      const target = tipTarget(event);
      if (!target || target === targetRef.current) return;
      hide();
      targetRef.current = target;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        // The button may have gone, or a dialog made it inert, while the pointer rested on it.
        if (targetRef.current === target && target.isConnected && !target.closest("[inert]")) showFor(target);
        else if (targetRef.current === target) hide();
      }, SHOW_DELAY_MS);
    }
    function onPointerOut(event: PointerEvent) {
      const target = targetRef.current;
      // Only the pointer leaving the tip's own button hides it; a keyboard tip ignores the pointer.
      if (!target || fromFocusRef.current) return;
      if (!(event.target instanceof Node) || !target.contains(event.target)) return;
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (next && target.contains(next)) return;
      hide();
    }
    function onFocusIn(event: FocusEvent) {
      const target = tipTarget(event);
      if (!target) return;
      // Keyboard focus only (a pointer press focuses too; it does not need a tip). A text field's tip
      // shows on hover only, so it never covers what is being typed.
      if (!target.matches(":focus-visible") || target.matches("input, textarea, [contenteditable]")) return;
      // Focus an action gave back on its own (focusQuietly): no tip, so it never covers a control beside it.
      if (target.hasAttribute(QUIET_FOCUS_ATTRIBUTE)) return;
      hide();
      fromFocusRef.current = true;
      showFor(target);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && targetRef.current) hide();
    }
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      clear();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKeyDown, true);
      if (reposition !== null) window.cancelAnimationFrame(reposition);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, []);

  // Once drawn: measured, clamped inside the viewport, then shown (no second render).
  useLayoutEffect(() => {
    const pill = pillRef.current;
    if (!tip || !pill) return;
    // A manual popover joins the top layer, so the tip also shows over an open modal dialog.
    if (typeof pill.showPopover === "function" && !pill.matches(":popover-open")) pill.showPopover();
    const rect = pill.getBoundingClientRect();
    const left = Math.min(Math.max(MARGIN, tip.left - rect.width / 2), window.innerWidth - rect.width - MARGIN);
    const top = tip.placement === "above" ? tip.top - rect.height : tip.top;
    pill.style.left = `${Math.max(MARGIN, left)}px`;
    pill.style.top = `${Math.max(MARGIN, Math.min(top, window.innerHeight - rect.height - MARGIN))}px`;
    pill.classList.add("is-shown");
  }, [tip]);

  if (!tip) return null;
  return (
    <div aria-hidden="true" className="df-tip" popover="manual" ref={pillRef}>
      {tip.text}
    </div>
  );
}
