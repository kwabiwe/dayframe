import { NextResponse } from "next/server";
import { expiredSessionCookieOptions, APP_SESSION_COOKIE, revokeLocalSession, sessionTokenFromRequest } from "@/lib/auth/local";

export async function POST(request: Request) {
  await revokeLocalSession(sessionTokenFromRequest(request));
  const response = NextResponse.json({ ok: true });
  response.cookies.set(APP_SESSION_COOKIE, "", expiredSessionCookieOptions());
  return response;
}
