import { NextResponse } from "next/server";
import { AuthError } from "@/lib/session";

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      {
        error: error.message,
        ...(error.code ? { code: error.code } : {})
      },
      { status: error.status }
    );
  }

  return null;
}
