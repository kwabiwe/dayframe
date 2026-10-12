import { NextResponse } from "next/server";
import { z } from "zod";
import { completeSupabasePasswordReset } from "@/lib/auth/supabase";
import { AuthError, getAuthMode } from "@/lib/session";

const ResetCompleteSchema = z.object({
  accessToken: z.string().min(1).max(8192),
  refreshToken: z.string().min(1).max(8192),
  password: z.string().min(8).max(256)
});

export async function POST(request: Request) {
  if (getAuthMode() !== "provider") {
    return NextResponse.json({ error: "Password reset is not available here." }, { status: 404 });
  }
  let input: z.infer<typeof ResetCompleteSchema>;
  try {
    input = ResetCompleteSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Use at least 8 characters for the new password." }, { status: 400 });
  }
  try {
    await completeSupabasePasswordReset(input);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Dayframe password reset failed");
    return NextResponse.json({ error: "Dayframe couldn't change the password. Try again." }, { status: 500 });
  }
}
