import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@dayframe/shared";

export type RequestSession = {
  userId: string;
  workspaceId: string;
  authMode: "dev" | "local" | "token" | "provider";
  scopes: string[];
};

export class AuthError extends Error {
  status: number;

  constructor(message = "Unauthorized", status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export const DEV_USER_ID = process.env.DAYFRAME_DEV_USER_ID ?? DEMO_USER_ID;
export const DEV_WORKSPACE_ID = process.env.DAYFRAME_DEV_WORKSPACE_ID ?? DEMO_WORKSPACE_ID;

export function getAuthMode() {
  const mode = process.env.DAYFRAME_AUTH_MODE ?? (process.env.NODE_ENV === "production" ? "provider" : "dev");
  if (mode === "dev" || mode === "local" || mode === "provider") return mode;
  return process.env.NODE_ENV === "production" ? "provider" : "dev";
}

export function getDevSession(): RequestSession {
  return {
    userId: DEV_USER_ID,
    workspaceId: DEV_WORKSPACE_ID,
    authMode: "dev",
    scopes: ["app:read", "app:write", "events:write", "toggl:import", "exports:read"]
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
