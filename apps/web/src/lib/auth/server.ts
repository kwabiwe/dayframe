import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { APP_SESSION_COOKIE, resolveLocalSession } from "@/lib/auth/local";
import { AuthError, DEV_WORKSPACE_COOKIE, getAuthMode, getDevSession, type RequestSession } from "@/lib/session";

export async function resolvePageSession(): Promise<RequestSession> {
  const mode = getAuthMode();
  if (mode === "dev") {
    const cookieStore = await cookies();
    return getDevSession(cookieStore.get(DEV_WORKSPACE_COOKIE)?.value);
  }
  if (mode === "local" || mode === "provider") {
    const session = await getOptionalPageSession();
    if (session) return session;
    redirect("/login");
  }

  throw new AuthError(
    "Provider auth is not configured yet. Use local auth for DB-backed local testing.",
    501
  );
}

export async function resolveOptionalPageSessionUncached(): Promise<RequestSession | null> {
  const mode = getAuthMode();
  if (mode === "dev") {
    const cookieStore = await cookies();
    return getDevSession(cookieStore.get(DEV_WORKSPACE_COOKIE)?.value);
  }
  if (mode !== "local" && mode !== "provider") return null;

  const cookieStore = await cookies();
  const token = cookieStore.get(APP_SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    return await resolveLocalSession(token, mode);
  } catch (error) {
    if (isExpectedAnonymousPageSessionError(error)) return null;
    throw error;
  }
}

export const getOptionalPageSession = cache(resolveOptionalPageSessionUncached);

export function isExpectedAnonymousPageSessionError(error: unknown): error is AuthError {
  return error instanceof AuthError && error.status === 401;
}

export function isAuthenticatedPageSession(
  session: RequestSession | null
): session is RequestSession {
  return session !== null;
}

export async function currentUserAgent() {
  const headerStore = await headers();
  return headerStore.get("user-agent");
}

export function resolveProviderSession(): RequestSession {
  throw new AuthError("Provider sessions require a request cookie or bearer token.", 401);
}
