"use client";

import type { FormEvent } from "react";
import { useEffect, useRef } from "react";

export function DestructiveConfirmationDialog({
  body,
  busyLabel = "Deleting...",
  confirmLabel = "Delete",
  dialogId,
  error,
  isBusy,
  onCancel,
  onConfirm,
  title
}: {
  body: string;
  busyLabel?: string;
  confirmLabel?: string;
  dialogId: string;
  error?: string | null;
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isBusy) onCancelRef.current();
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [isBusy]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isBusy) onConfirm();
  }

  function cancel() {
    if (!isBusy) onCancel();
  }

  return (
    <div className="swiss-dialog-backdrop" role="presentation" onMouseDown={cancel}>
      <section
        className="swiss-dialog swiss-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="swiss-dialog-header">
          <h2 id={titleId}>{title}</h2>
        </div>
        <form className="swiss-confirm-body" onSubmit={submit}>
          <p id={descriptionId}>{body}</p>
          {error ? (
            <p className="swiss-inline-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="swiss-dialog-actions">
            <button type="button" ref={cancelButtonRef} disabled={isBusy} onClick={cancel}>
              Cancel
            </button>
            <button className="swiss-destructive-action" type="submit" disabled={isBusy}>
              {isBusy ? busyLabel : confirmLabel}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
