import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@dayframe/shared";

export type RequestSession = {
  userId: string;
  workspaceId: string;
  authMode: "dev" | "token" | "provider";
  scopes: string[];
};

export class AuthError extends Error {
  status = 401;

  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

export const DEV_USER_ID = process.env.DAYFRAME_DEV_USER_ID ?? DEMO_USER_ID;
export const DEV_WORKSPACE_ID = process.env.DAYFRAME_DEV_WORKSPACE_ID ?? DEMO_WORKSPACE_ID;

export function getAuthMode() {
  return process.env.DAYFRAME_AUTH_MODE ?? (process.env.NODE_ENV === "production" ? "provider" : "dev");
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
    "No production auth provider is configured. Set DAYFRAME_AUTH_MODE=dev for local development or use an integration token for ingest-only requests."
  );
}

export function hasScopes(session: RequestSession, requiredScopes: string[]) {
  return requiredScopes.every((scope) => session.scopes.includes(scope));
}
