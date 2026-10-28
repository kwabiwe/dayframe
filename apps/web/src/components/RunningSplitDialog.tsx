"use client";

import { useEffect, useRef, useState } from "react";
import type { ClockFormat } from "@dayframe/shared";
import { SplitLine } from "@/components/TimeEntryQuickEditor";
import { ModalDialog } from "@/components/ui/Primitives";
import type { TimeEntryRow } from "@/lib/queries";
import { clampSplit, defaultSplit, runningSplitBounds } from "@/lib/time-entry-split";

/** The bar's now edge moves on with the clock while the dialog is open (and only then). */
const NOW_TICK_MS = 1_000;

/**
 * Split for the running block (owner 28 Oct 2026, as Toggl): card G's split bar in a dialog, from the block's
 * start to now, with the now edge growing while it is open. The line moves in whole minutes and never into the
 * first minute or the last minute before now; "Split at HH:MM" ends the block there and the second part keeps
 * running with every detail.
 */
export function RunningSplitDialog({ clock, color, colorName, entry, onClose, onSplit }: {
  clock: ClockFormat;
  color?: string | null;
  colorName?: string | null;
  entry: Pick<TimeEntryRow, "startedAt">;
  onClose: () => void;
  /** Resolves with an error to show, or null once split (the host then closes the dialog). */
  onSplit: (atMs: number) => Promise<string | null>;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), NOW_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const bounds = runningSplitBounds(entry, nowMs);
  const [chosenMs, setChosenMs] = useState<number | null>(() => bounds ? defaultSplit(bounds) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  // The dialog opens on the line, so the arrow keys move it at once.
  const lineRef = useRef<HTMLInputElement | null>(null);
  const atMs = bounds ? clampSplit(bounds, chosenMs ?? defaultSplit(bounds)) : null;

  async function confirm() {
    if (atMs == null || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const failure = await onSplit(atMs);
    busyRef.current = false;
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <ModalDialog busy={busy} className="running-split-dialog" initialFocusRef={bounds ? lineRef : undefined} onClose={onClose} size="compact" title="Split running block">
      {bounds && atMs != null ? (
        <SplitLine
          atMs={atMs}
          bounds={bounds}
          canConfirm={!busy}
          clock={clock}
          color={color}
          colorName={colorName ?? undefined}
          disabled={busy}
          lineRef={lineRef}
          onCancel={onClose}
          onConfirm={() => void confirm()}
          onMove={(next) => setChosenMs(clampSplit(bounds, next))}
          open
        />
      ) : (
        <p className="running-split-dialog-note">This block is too short to split yet: each part needs a minute or more.</p>
      )}
      {error ? <p className="ui-field-error" role="alert">{error}</p> : null}
    </ModalDialog>
  );
}
