import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { APP_SESSION_COOKIE, loginLocalAccount, sessionCookieOptions } from "@/lib/auth/local";
import { AuthError, getAuthMode } from "@/lib/session";

export async function POST(request: Request) {
  if (getAuthMode() === "provider") {
    return NextResponse.json({ error: "Provider auth is not implemented yet." }, { status: 501 });
  }

  try {
    const auth = await loginLocalAccount(await request.json(), request.headers.get("user-agent"));
    const response = NextResponse.json(auth);
    response.cookies.set(APP_SESSION_COOKIE, auth.token, sessionCookieOptions());
    return response;
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
    }
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
