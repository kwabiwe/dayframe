"use client";

import { ConfirmDialog } from "@/components/blocks/ConfirmDialog";

/**
 * A destructive question (Delete tag, …) in the one web confirmation (web UI audit WUI-009, owner
 * 17 Oct 2026): `ConfirmDialog` with Cancel focused and a solid red action, its error under the
 * body, and both buttons waiting while the action runs. Hosts mount it while the question is open.
 */
export function DestructiveConfirmationDialog({
  body,
  busyLabel = "Deleting…",
  confirmLabel = "Delete",
  error,
  isBusy,
  onCancel,
  onConfirm,
  open = true,
  title
}: {
  body: string;
  busyLabel?: string;
  confirmLabel?: string;
  /** Kept for callers; the dialog no longer needs a form id. */
  dialogId?: string;
  error?: string | null;
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** Keep it mounted with `open={false}` to let it fade out and hand focus back. */
  open?: boolean;
  title: string;
}) {
  return (
    <ConfirmDialog
      body={body}
      busy={isBusy}
      busyLabel={busyLabel}
      confirmLabel={confirmLabel}
      error={error}
      onCancel={onCancel}
      onConfirm={() => {
        if (!isBusy) onConfirm();
      }}
      open={open}
      title={title}
    />
  );
}
