import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { APP_SESSION_COOKIE, sessionCookieOptions, signupLocalAccount } from "@/lib/auth/local";
import { AuthError, getAuthMode } from "@/lib/session";

export async function POST(request: Request) {
  if (getAuthMode() === "provider") {
    return NextResponse.json({ error: "Provider auth is not implemented yet." }, { status: 501 });
  }

  try {
    const auth = await signupLocalAccount(await request.json(), request.headers.get("user-agent"));
    const response = NextResponse.json(auth, { status: 201 });
    response.cookies.set(APP_SESSION_COOKIE, auth.token, sessionCookieOptions());
    return response;
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Enter a valid email and a password of at least 8 characters." }, { status: 400 });
    }
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
