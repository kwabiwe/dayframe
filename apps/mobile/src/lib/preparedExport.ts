// A Settings export whose preparation blocks the JS thread for a moment (Share location details runs the
// local journal replay, stability audit 22 Oct 2026, location-3). Its row says "Preparing…" and is
// disabled while it runs, so a second press cannot start a second export, and that state paints before
// the blocking work starts. No imports: Node tests run it with fake frames.

export type PreparedExportGuard = { current: boolean };

/** Resolves after the next frame has painted: one animation frame, then a macrotask. */
export function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback: () => void) => setTimeout(callback, 16);
    frame(() => setTimeout(resolve, 0));
  });
}

/** Runs `work` once at a time; a press while it runs returns false and does nothing. */
export async function runPreparedExport(
  guard: PreparedExportGuard,
  setPreparing: (preparing: boolean) => void,
  work: () => Promise<void>,
  yieldToPaint: () => Promise<void> = afterNextPaint
): Promise<boolean> {
  if (guard.current) return false;
  guard.current = true;
  setPreparing(true);
  try {
    await yieldToPaint();
    await work();
    return true;
  } finally {
    guard.current = false;
    setPreparing(false);
  }
}
