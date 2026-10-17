"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";

// Open confirmations, oldest first, and the page elements this module made inert. Only the newest
// dialog is interactive; the page (and any older dialog) stays inert until the last one closes
// (Codex r2 on #469). Elements made inert by someone else are left alone.
const modalStack: HTMLElement[] = [];
const isolatedByStack = new Set<HTMLElement>();

function syncModalIsolation() {
  const top = modalStack[modalStack.length - 1] ?? null;
  for (const element of [...isolatedByStack]) {
    if (top && element !== top && element.isConnected) continue;
    element.removeAttribute("inert");
    isolatedByStack.delete(element);
  }
  if (!top) return;
  for (const element of document.body.children) {
    if (!(element instanceof HTMLElement) || element === top || element.hasAttribute("inert")) continue;
    element.setAttribute("inert", "");
    isolatedByStack.add(element);
  }
}

function openModal(layer: HTMLElement) {
  modalStack.push(layer);
  syncModalIsolation();
}

function closeModal(layer: HTMLElement) {
  const index = modalStack.lastIndexOf(layer);
  if (index >= 0) modalStack.splice(index, 1);
  // A closed layer is inert through its own prop; the stack no longer owns that attribute.
  isolatedByStack.delete(layer);
  syncModalIsolation();
}

/**
 * The one web confirmation (audit WUI-005/WUI-009, owner 17 Oct 2026; the web twin of the iPhone's
 * BlocksConfirmSheet): a small centred dialog over a scrim, a question for its title, one short
 * line of body, a neutral way back (focused when it opens) and the confirming action. Escape, the
 * scrim and the way back all cancel; only the confirming button confirms. Width min(400 px,
 * 100vw − 24 px), so it is phone-safe without becoming a sheet.
 *
 * Motion: the scrim fades and the card fades in from scale(.98) in 160 ms, and both fade out in
 * 90 ms (the block editor's own exit, so a Discard that closes both never cuts the fade); under
 * Reduce Motion only the opacities change. The host owns `open`; the dialog stays
 * mounted (hidden and inert while closed), so a fast close never cuts the fade and no presence
 * timer can race a reopening.
 *
 * `surfaceClassName` lets a host treat the dialog as part of its own interaction boundary (the
 * block editor passes `time-entry-quick-editor-nested-surface`, so a press inside it is not an
 * outside press and Tab containment includes it).
 */
export function ConfirmDialog({
  body,
  busy = false,
  busyLabel,
  cancelLabel = "Cancel",
  cancelRef,
  confirmLabel,
  error,
  onCancel,
  onConfirm,
  open,
  surfaceClassName = "",
  title,
  tone = "danger"
}: {
  body?: string;
  /** The confirmed action is running: both buttons wait, Escape and the scrim do nothing. */
  busy?: boolean;
  /** The confirming button's label while busy ("Deleting…"). */
  busyLabel?: string;
  cancelLabel?: string;
  /** Receives the way-back button, which takes focus when the dialog opens. */
  cancelRef?: RefObject<HTMLButtonElement | null>;
  confirmLabel: string;
  /** Why the action failed, under the body (an alert); the dialog stays for a retry or Cancel. */
  error?: string | null;
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
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [entered, setEntered] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  // Closing starts the fade at once; opening fades in on the next frame.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setEntered(false);
  }

  useEffect(() => {
    if (!open) return undefined;
    // Modal, as a native dialog's showModal() is (Codex r1 and r2 on #469): everything else on the
    // page, older confirmations included, is inert while it asks, and focus goes back to what opened
    // it when it closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer = layerRef.current;
    if (layer) openModal(layer);
    const frame = window.requestAnimationFrame(() => {
      setEntered(true);
      backRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (layer) closeModal(layer);
      const active = document.activeElement;
      const focusLeftWithDialog = !active || active === document.body || Boolean(layer?.contains(active));
      if (focusLeftWithDialog && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [backRef, open]);

  if (typeof document === "undefined") return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onCancel();
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
      // of the accessibility tree once its fade has run (CSS holds visibility for 90 ms).
      aria-hidden={open ? undefined : true}
      className={`df-confirm-layer ${surfaceClassName}${open ? " is-open" : ""}${open && entered ? " is-entered" : ""}`.trim()}
      ref={layerRef}
      data-testid="confirm-dialog"
      inert={!open || undefined}
      onKeyDown={onKeyDown}
    >
      <div
        className="df-confirm-scrim"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.preventDefault();
          if (open && !busy) onCancel();
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
        {error ? <p className="df-confirm-error" role="alert">{error}</p> : null}
        <div className="df-confirm-actions">
          <button
            ref={backRef}
            aria-disabled={busy || undefined}
            className="df-rbtn"
            type="button"
            onClick={() => {
              if (!busy) onCancel();
            }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            aria-busy={busy || undefined}
            // Busy buttons stay focusable, so focus is never lost while the action runs.
            aria-disabled={busy || undefined}
            className={tone === "danger" ? "df-rbtn df-rbtn--danger" : "df-rbtn df-rbtn--inverse"}
            type="button"
            onClick={() => {
              if (!busy) onConfirm();
            }}
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
