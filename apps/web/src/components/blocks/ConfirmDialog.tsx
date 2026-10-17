"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * The one web confirmation (audit WUI-005/WUI-009, owner 17 Oct 2026; the web twin of the iPhone's
 * BlocksConfirmSheet): a small centred dialog over a scrim, a question for its title, one short
 * line of body, a neutral way back (focused when it opens) and the confirming action. Escape, the
 * scrim and the way back all cancel; only the confirming button confirms. Width min(400 px,
 * 100vw − 24 px), so it is phone-safe without becoming a sheet.
 *
 * Motion: the scrim fades and the card fades in from scale(.98) in 160 ms, and both fade out in
 * 120 ms; under Reduce Motion only the opacities change. The host owns `open`; the dialog stays
 * mounted (hidden and inert while closed), so a fast close never cuts the fade and no presence
 * timer can race a reopening.
 *
 * `surfaceClassName` lets a host treat the dialog as part of its own interaction boundary (the
 * block editor passes `time-entry-quick-editor-nested-surface`, so a press inside it is not an
 * outside press and Tab containment includes it).
 */
export function ConfirmDialog({
  body,
  cancelLabel = "Cancel",
  cancelRef,
  confirmLabel,
  onCancel,
  onConfirm,
  open,
  surfaceClassName = "",
  title,
  tone = "danger"
}: {
  body?: string;
  cancelLabel?: string;
  /** Receives the way-back button, which takes focus when the dialog opens. */
  cancelRef?: RefObject<HTMLButtonElement | null>;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  surfaceClassName?: string;
  title: string;
  /** `danger` for a destructive action (solid red); `neutral` for a reversible one. */
  tone?: "danger" | "neutral";
}) {
  const titleId = useId();
  const bodyId = useId();
  const ownCancelRef = useRef<HTMLButtonElement | null>(null);
  const backRef = cancelRef ?? ownCancelRef;
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const [entered, setEntered] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  // Closing starts the fade at once; opening fades in on the next frame.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setEntered(false);
  }

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => {
      setEntered(true);
      backRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [backRef, open]);

  if (typeof document === "undefined") return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    // Two buttons: Tab and Shift+Tab move between them and never leave the dialog.
    event.preventDefault();
    event.stopPropagation();
    const next = document.activeElement === backRef.current ? confirmRef.current : backRef.current;
    next?.focus();
  }

  return createPortal(
    <div
      // Always mounted (no presence timer to race an opening): closed, it is hidden, inert and out
      // of the accessibility tree once its fade has run (CSS holds visibility for 120 ms).
      aria-hidden={open ? undefined : true}
      className={`df-confirm-layer ${surfaceClassName}${open ? " is-open" : ""}${open && entered ? " is-entered" : ""}`.trim()}
      data-testid="confirm-dialog"
      inert={!open || undefined}
      onKeyDown={onKeyDown}
    >
      <div
        className="df-confirm-scrim"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.preventDefault();
          if (open) onCancel();
        }}
      />
      <div
        className="df-confirm"
        // While it fades out after closing, the card is no longer a dialog for assistive technology.
        role={open ? "alertdialog" : undefined}
        aria-modal={open || undefined}
        aria-hidden={open ? undefined : true}
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        inert={!open || undefined}
      >
        <h2 className="df-confirm-title" id={titleId}>{title}</h2>
        {body ? <p className="df-confirm-body" id={bodyId}>{body}</p> : null}
        <div className="df-confirm-actions">
          <button ref={backRef} className="df-rbtn" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            className={tone === "danger" ? "df-rbtn df-rbtn--danger" : "df-rbtn df-rbtn--inverse"}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
