import { NextResponse } from "next/server";
import { expiredSessionCookieOptions, APP_SESSION_COOKIE, revokeLocalSession, sessionTokenFromRequest } from "@/lib/auth/local";

export async function GET(request: Request) {
  await revokeLocalSession(sessionTokenFromRequest(request));
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.set(APP_SESSION_COOKIE, "", expiredSessionCookieOptions());
  return response;
}
