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
  exiting = false,
  message,
  onAction,
  swatchStyle
}: {
  actionLabel?: string;
  /** Move focus to the action when the toast appears (when the surface that was focused just went away). */
  autoFocusAction?: boolean;
  exiting?: boolean;
  message: string;
  onAction?: () => void;
  swatchStyle?: CSSProperties;
}) {
  const pop = springTransition("pop");
  const actionRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!autoFocusAction || exiting) return;
    const frame = window.requestAnimationFrame(() => actionRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocusAction, exiting]);
  return (
    <div className="df-toast-host">
      <div
        className={`df-toast${exiting ? " is-exiting" : ""}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{ "--df-toast-pop": pop.easing, "--df-toast-pop-ms": `${pop.durationMs}ms` } as CSSProperties}
      >
        <span className="df-toast-swatch" style={swatchStyle} aria-hidden="true" />
        <span className="df-toast-message">{message}</span>
        {actionLabel && onAction ? (
          <button className="df-toast-action" disabled={exiting} onClick={onAction} ref={actionRef} type="button">
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
