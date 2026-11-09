"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import { springTransition } from "@/lib/blocks-motion";

/**
 * The Blocks inverse toast (prototype `DF.toast`): a pill along the bottom of the page with an
 * activity swatch, a message and an optional action such as Undo. Its owner keeps the notice's
 * lifetime and token; this component only draws it. A new token re-mounts it, so a replacing
 * notice pops in again and a stale exit can never hide a newer one.
 */
export function BlocksToast({
  actionLabel,
  autoFocusAction = false,
  detail,
  focusActionIfLost = false,
  exiting = false,
  message,
  onAction,
  secondary,
  stacked = null,
  swatchStyle,
  tone = "notice"
}: {
  actionLabel?: string;
  /** Move focus to the action when the toast appears (when the surface that was focused just went away). */
  autoFocusAction?: boolean;
  /**
   * Move focus to the action only when focus has nowhere else to be (the page, or a toast that just
   * left): an error toast that replaces a focused Undo toast keeps the keyboard on it.
   */
  focusActionIfLost?: boolean;
  /** A muted second line under the message ("42m logged to Client Work"), as on iPhone. */
  detail?: string | null;
  exiting?: boolean;
  message: string;
  onAction?: () => void;
  /**
   * A second, less common action on its own row under the message ("Don't log trips like this"),
   * replaced in the same row by its outcome (`done`) so the toast never changes height.
   */
  secondary?: { label: string; onAction: () => void; done?: string | null; busy?: boolean } | null;
  swatchStyle?: CSSProperties;
  /**
   * Another toast holds the bottom place with an action of its own (a delete's Undo while a "?" answer's Undo is
   * pending; Codex r2 on #618): this one sits just above it, so both actions stay reachable. `tall` clears a toast
   * with a second row.
   */
  stacked?: "above" | "above-tall" | null;
  /**
   * `error` (WUI-027): the same inverse pill with a danger swatch, announced assertively (an alert),
   * for a failure the user can act on (Try again) — never a second kind of toast.
   */
  tone?: "notice" | "error";
}) {
  const pop = springTransition("pop");
  const actionRef = useRef<HTMLButtonElement | null>(null);
  // The second action's button had focus when it was replaced by its outcome: focus moves to the
  // main action (Undo), unless focus has gone somewhere else meanwhile (Codex r1 on #463).
  const secondaryRef = useRef<HTMLButtonElement | null>(null);
  const secondaryHadFocus = useRef(false);
  const secondaryDone = secondary?.done ?? null;
  useEffect(() => {
    if (!secondaryDone || !secondaryHadFocus.current) return;
    secondaryHadFocus.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) actionRef.current?.focus();
  }, [secondaryDone]);
  useEffect(() => {
    if (!focusActionIfLost || exiting) return;
    const frame = window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body || active.closest(".df-toast-host")) actionRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusActionIfLost, exiting]);
  useEffect(() => {
    if (!autoFocusAction || exiting) return;
    const frame = window.requestAnimationFrame(() => actionRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocusAction, exiting]);
  return (
    <div className={`df-toast-host${stacked ? ` is-stacked${stacked === "above-tall" ? " is-stacked-tall" : ""}` : ""}`}>
      <div
        className={`df-toast${detail ? " has-detail" : ""}${secondary ? " has-secondary" : ""}${tone === "error" ? " is-error" : ""}${exiting ? " is-exiting" : ""}`}
        role={tone === "error" ? "alert" : "status"}
        aria-live={tone === "error" ? "assertive" : "polite"}
        aria-atomic="true"
        style={{ "--df-toast-pop": pop.easing, "--df-toast-pop-ms": `${pop.durationMs}ms` } as CSSProperties}
      >
        <span className="df-toast-swatch" style={swatchStyle} aria-hidden="true" />
        {detail ? (
          // Two lines, each wrapping once at most: the message, then the muted detail.
          <span className="df-toast-text">
            <span className="df-toast-message">{message}</span>
            <span className="df-toast-detail">{detail}</span>
          </span>
        ) : (
          <span className="df-toast-message">{message}</span>
        )}
        {actionLabel && onAction ? (
          <button className="df-toast-action" disabled={exiting} onClick={onAction} ref={actionRef} type="button">
            {actionLabel}
          </button>
        ) : null}
        {secondary ? (
          <span className="df-toast-secondary">
            {secondary.done ? (
              <span className="df-toast-secondary-done">{secondary.done}</span>
            ) : (
              <button
                className="df-toast-action df-toast-action--secondary"
                disabled={exiting || secondary.busy}
                onBlur={() => { if (!secondary.busy) secondaryHadFocus.current = false; }}
                onClick={secondary.onAction}
                onFocus={() => { secondaryHadFocus.current = true; }}
                ref={secondaryRef}
                type="button"
              >
                {secondary.label}
              </button>
            )}
          </span>
        ) : null}
      </div>
    </div>
  );
}
