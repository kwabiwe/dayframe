import { NextResponse } from "next/server";
import { z } from "zod";
import { requestSupabasePasswordReset } from "@/lib/auth/supabase";
import { AuthError, getAuthMode } from "@/lib/session";

const ResetRequestSchema = z.object({ email: z.string().trim().email().max(320) });

/** The same reply whether or not an account uses the address (UIA-317). */
const SENT = { ok: true, message: "If an account uses that email, a reset link is on its way. Check your email." };

export async function POST(request: Request) {
  if (getAuthMode() !== "provider") {
    return NextResponse.json({ error: "Password reset is not available here." }, { status: 404 });
  }
  let email: string;
  try {
    email = ResetRequestSchema.parse(await request.json()).email;
  } catch {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  try {
    // The link returns to this deployment's reset page; Supabase only follows redirect URLs that
    // are allowed in its Auth settings.
    await requestSupabasePasswordReset(email, new URL("/reset-password", request.url).toString());
    return NextResponse.json(SENT);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Dayframe password reset request failed");
    return NextResponse.json({ error: "Dayframe couldn't send the reset email. Try again later." }, { status: 502 });
  }
}
