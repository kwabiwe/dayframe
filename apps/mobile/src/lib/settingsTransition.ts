/**
 * I1: Settings work that must not compete with a push or pop animation. On RN 0.85
 * InteractionManager no longer waits for navigation, so this waits for the native-stack
 * `transitionEnd` of the screen itself, with a timer fallback for presentations that emit none
 * (no animation, an already-finished transition, Reduce Motion).
 */
export const SETTINGS_TRANSITION_FALLBACK_MS = 650;

export type TransitionGate = {
  /** Calls the listener when this screen's opening (not closing) transition ends. */
  subscribeTransitionEnd: (listener: () => void) => () => void;
  fallbackMs?: number;
  /** False when the account changed since scheduling: the work is discarded, never run. */
  isCurrent?: () => boolean;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/** Runs `work` once, after the transition; returns a cancel that guarantees it never runs. */
export function afterSettingsTransition(gate: TransitionGate, work: () => void): () => void {
  const setTimer = gate.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = gate.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let done = false;
  let unsubscribe: (() => void) | null = null;
  let timer: unknown = null;
  const finish = () => {
    if (done) return;
    done = true;
    unsubscribe?.();
    clearTimer(timer);
  };
  const fire = () => {
    if (done) return;
    finish();
    if (gate.isCurrent && !gate.isCurrent()) return;
    work();
  };
  unsubscribe = gate.subscribeTransitionEnd(fire);
  timer = setTimer(fire, gate.fallbackMs ?? SETTINGS_TRANSITION_FALLBACK_MS);
  if (done) unsubscribe();
  return finish;
}
