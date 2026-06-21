import { NextResponse } from "next/server";
import { resolveReviewItem } from "@/lib/event-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json();
  await resolveReviewItem(id, body.action);
  return NextResponse.json({ ok: true });
}
