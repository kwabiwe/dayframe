import { NextResponse } from "next/server";
import { resolveReviewItem } from "@/lib/event-service";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await resolveRequestSession(request);
  const { id } = await context.params;
  const body = await request.json();
  await resolveReviewItem(id, body.action, session);
  return NextResponse.json({ ok: true });
}
