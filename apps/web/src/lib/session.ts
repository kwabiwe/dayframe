import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@dayframe/shared";

export type RequestSession = {
  userId: string;
  workspaceId: string;
  authMode: "dev" | "local" | "token" | "provider";
  scopes: string[];
};

export const SESSION_REASON_CODES = [
  "session_cookie_missing",
  "session_invalid",
  "session_expired",
  "session_revoked",
  "session_valid"
] as const;

export type SessionReasonCode = (typeof SESSION_REASON_CODES)[number];
export const SESSION_ERROR_CODES = SESSION_REASON_CODES.filter(
  (code): code is Exclude<SessionReasonCode, "session_valid"> => code !== "session_valid"
);
export type PublicAuthErrorCode =
  | Exclude<SessionReasonCode, "session_valid">
  | "insufficient_scope"
  | "integration_token_invalid";

export class AuthError extends Error {
  status: number;
  code?: PublicAuthErrorCode;

  constructor(message = "Unauthorized", status = 401, code?: PublicAuthErrorCode) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

export function sessionAuthError(
  reason: Exclude<SessionReasonCode, "session_valid">
) {
  const message =
    reason === "session_expired"
      ? "Your Dayframe session has expired."
      : reason === "session_revoked"
        ? "Your Dayframe session has ended."
        : "Login required.";
  return new AuthError(message, 401, reason);
}

export function isSessionAuthError(
  error: unknown
): error is AuthError & { code: Exclude<SessionReasonCode, "session_valid"> } {
  return (
    error instanceof AuthError &&
    error.status === 401 &&
    error.code !== undefined &&
    SESSION_ERROR_CODES.includes(
      error.code as Exclude<SessionReasonCode, "session_valid">
    )
  );
}

export const DEV_USER_ID = process.env.DAYFRAME_DEV_USER_ID ?? DEMO_USER_ID;
export const DEV_WORKSPACE_ID = process.env.DAYFRAME_DEV_WORKSPACE_ID ?? DEMO_WORKSPACE_ID;
export const DEV_WORKSPACE_COOKIE = "dayframe_dev_workspace";
const DEV_WORKSPACE_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 30;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getAuthMode() {
  const mode = process.env.DAYFRAME_AUTH_MODE ?? (process.env.NODE_ENV === "production" ? "provider" : "dev");
  if (mode === "dev" || mode === "local" || mode === "provider") return mode;
  return process.env.NODE_ENV === "production" ? "provider" : "dev";
}

export function getDevSession(workspaceId?: string | null): RequestSession {
  return {
    userId: DEV_USER_ID,
    workspaceId: normalizeDevWorkspaceId(workspaceId),
    authMode: "dev",
    scopes: ["app:read", "app:write", "events:write", "time:read", "exports:read"]
  };
}

export function normalizeDevWorkspaceId(workspaceId?: string | null) {
  const nextWorkspaceId = workspaceId?.trim();
  return nextWorkspaceId && uuidPattern.test(nextWorkspaceId) ? nextWorkspaceId : DEV_WORKSPACE_ID;
}

export function devWorkspaceIdFromCookieHeader(cookieHeader: string | null | undefined) {
  if (!cookieHeader) return DEV_WORKSPACE_ID;
  for (const cookie of cookieHeader.split(";")) {
    const [name, ...rest] = cookie.trim().split("=");
    if (name === DEV_WORKSPACE_COOKIE) {
      return normalizeDevWorkspaceId(decodeURIComponent(rest.join("=")));
    }
  }
  return DEV_WORKSPACE_ID;
}

export function devWorkspaceCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEV_WORKSPACE_COOKIE_TTL_SECONDS
  };
}

export function resolveAppSession(): RequestSession {
  const mode = getAuthMode();
  if (mode === "dev") return getDevSession();

  throw new AuthError(
    mode === "local"
      ? "Login required."
      : "Provider auth requires a request cookie or bearer token."
  );
}

export function hasScopes(session: RequestSession, requiredScopes: string[]) {
  return requiredScopes.every((scope) => session.scopes.includes(scope));
}
