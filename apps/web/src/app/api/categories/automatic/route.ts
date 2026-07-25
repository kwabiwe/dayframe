import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ensureAutomaticLoggingCategories,
  type AutomaticLoggingCategoryKind
} from "@/lib/event-service";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";

const requestSchema = z.object({
  kinds: z.array(z.enum(["sleep", "health", "commute"])).min(1).max(3)
});

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = requestSchema.parse(await request.json());
    const categories = await ensureAutomaticLoggingCategories(
      body.kinds as AutomaticLoggingCategoryKind[],
      session
    );
    return NextResponse.json({ ok: true, categories });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
