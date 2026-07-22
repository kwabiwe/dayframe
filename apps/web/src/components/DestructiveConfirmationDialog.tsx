"use client";

import type { FormEvent } from "react";
import { useRef } from "react";
import { Button, ModalDialog } from "@/components/ui/Primitives";

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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isBusy) onConfirm();
  }

  function cancel() {
    if (!isBusy) onCancel();
  }

  return (
    <ModalDialog
      busy={isBusy}
      className="ui-confirm-dialog"
      description={body}
      initialFocusRef={cancelButtonRef}
      onClose={cancel}
      role="alertdialog"
      showClose={false}
      title={title}
      footer={(
        <>
          <Button ref={cancelButtonRef} disabled={isBusy} onClick={cancel}>
            Cancel
          </Button>
          <Button variant="danger" type="submit" form={`${dialogId}-form`} disabled={isBusy}>
            {isBusy ? busyLabel : confirmLabel}
          </Button>
        </>
      )}
    >
      <form id={`${dialogId}-form`} className="swiss-confirm-body" onSubmit={submit}>
        {error ? (
          <p className="swiss-inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </ModalDialog>
  );
}
