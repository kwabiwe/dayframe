import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { APP_SESSION_COOKIE, resolveLocalSession } from "@/lib/auth/local";
import { AuthError, getAuthMode, getDevSession, type RequestSession } from "@/lib/session";

export async function resolvePageSession(): Promise<RequestSession> {
  const mode = getAuthMode();
  if (mode === "dev") return getDevSession();
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

export async function getOptionalPageSession(): Promise<RequestSession | null> {
  const mode = getAuthMode();
  if (mode === "dev") return getDevSession();
  if (mode !== "local" && mode !== "provider") return null;

  const cookieStore = await cookies();
  const token = cookieStore.get(APP_SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    return await resolveLocalSession(token, mode);
  } catch {
    return null;
  }
}

export async function currentUserAgent() {
  const headerStore = await headers();
  return headerStore.get("user-agent");
}

export function resolveProviderSession(): RequestSession {
  throw new AuthError("Provider sessions require a request cookie or bearer token.", 401);
}
