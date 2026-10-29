/**
 * The one guarded notifier for the Calendar's answer, Logs as and recovery flows (Codex r15 on #610). A notice,
 * alert or VoiceOver announcement from them goes through here, and is said only if, at the moment it would be said,
 * Dayframe is in front, its screen is still there, and the signed-in account is the one the operation was for. A
 * late result after teardown, backgrounding or an account switch says nothing.
 */
export type NoticeGuard = {
  /** Dayframe in front now. */
  inFront: () => boolean;
  /** The screen that started the operation is still there (and, for a quiet one, still meant to speak). */
  mounted: () => boolean;
  /** The account signed in now is the operation's. */
  sameAccount: () => boolean;
};

/** Says it (`say`) only if the guard holds now. Whether it was said. */
export function sayIfStillHere(guard: NoticeGuard, say: () => void) {
  if (!guard.inFront() || !guard.mounted() || !guard.sameAccount()) return false;
  say();
  return true;
}
