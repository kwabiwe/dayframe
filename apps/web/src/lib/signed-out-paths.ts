/**
 * Pages used while signed out: no app shell, and no redirect to Log in when a session ends. The
 * reset page ends the visitor's own sessions while it works, so it must never be taken away from
 * them mid-reset (UIA-317).
 */
export const SIGNED_OUT_PATHS: ReadonlySet<string> = new Set(["/login", "/signup", "/reset-password"]);

export function isSignedOutPath(pathname: string | null | undefined) {
  return pathname != null && SIGNED_OUT_PATHS.has(pathname);
}
