import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import {
  LiveActivityRegistrationError,
  registerLiveActivity
} from "@/lib/live-activity-push";
import { scheduleLiveActivityNotification } from "@/lib/live-activity-post-response";

const RegistrationSchema = z.object({
  token: z.string().regex(/^[0-9a-f]+$/i).min(32).max(512),
  activityId: z.string().min(1).max(128),
  activeEntryId: z.string().uuid(),
  environment: z.enum(["development", "production"])
});

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const registration = RegistrationSchema.parse(await request.json());
    await registerLiveActivity(session, registration);
    scheduleLiveActivityNotification(session);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof LiveActivityRegistrationError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
