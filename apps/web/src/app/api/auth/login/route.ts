import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { APP_SESSION_COOKIE, loginLocalAccount, sessionCookieOptions } from "@/lib/auth/local";
import { loginSupabaseAccount } from "@/lib/auth/supabase";
import { AuthError, getAuthMode } from "@/lib/session";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const auth =
      getAuthMode() === "provider"
        ? await loginSupabaseAccount(body, request.headers.get("user-agent"))
        : await loginLocalAccount(body, request.headers.get("user-agent"));
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
