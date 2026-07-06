"use client";

import type { FormEvent } from "react";
import { useEffect, useRef } from "react";

const deleteRunningTimerDescription = "This removes the entry instead of stopping it.";

export function DeleteRunningTimerDialog({
  error,
  isBusy,
  onCancel,
  onDelete
}: {
  error?: string | null;
  isBusy: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCancelRef = useRef(onCancel);

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
    if (!isBusy) onDelete();
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
        aria-labelledby="delete-running-timer-title"
        aria-describedby="delete-running-timer-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="swiss-dialog-header">
          <h2 id="delete-running-timer-title">Delete running timer?</h2>
        </div>
        <form className="swiss-confirm-body" onSubmit={submit}>
          <p id="delete-running-timer-description">{deleteRunningTimerDescription}</p>
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
              {isBusy ? "Deleting..." : "Delete"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
