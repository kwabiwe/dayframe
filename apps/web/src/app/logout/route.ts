import { NextResponse } from "next/server";
import { expiredSessionCookieOptions, APP_SESSION_COOKIE, revokeLocalSession, sessionTokenFromRequest } from "@/lib/auth/local";

export async function GET() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" }
  });
}

export async function POST(request: Request) {
  await revokeLocalSession(sessionTokenFromRequest(request));
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: "/login?signedOut=1" }
  });
  response.cookies.set(APP_SESSION_COOKIE, "", expiredSessionCookieOptions());
  return response;
}
