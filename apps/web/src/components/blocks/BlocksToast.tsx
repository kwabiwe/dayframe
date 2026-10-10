"use client";

import type { CSSProperties } from "react";
import { springTransition } from "@/lib/blocks-motion";

/**
 * The Blocks inverse toast (prototype `DF.toast`): a pill along the bottom of the page with an
 * activity swatch, a message and an optional action such as Undo. Its owner keeps the notice's
 * lifetime and token; this component only draws it. A new token re-mounts it, so a replacing
 * notice pops in again and a stale exit can never hide a newer one.
 */
export function BlocksToast({
  actionLabel,
  exiting = false,
  message,
  onAction,
  swatchStyle
}: {
  actionLabel?: string;
  exiting?: boolean;
  message: string;
  onAction?: () => void;
  swatchStyle?: CSSProperties;
}) {
  const pop = springTransition("pop");
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
          <button className="df-toast-action" disabled={exiting} onClick={onAction} type="button">
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
