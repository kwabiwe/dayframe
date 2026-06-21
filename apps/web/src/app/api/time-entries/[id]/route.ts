import { NextResponse } from "next/server";
import { deleteTimeEntry, updateTimeEntry } from "@/lib/event-service";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await resolveRequestSession(request);
  const { id } = await context.params;
  const body = await request.json();
  await updateTimeEntry(id, body, session);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await resolveRequestSession(request);
  const { id } = await context.params;
  await deleteTimeEntry(id, session);
  return NextResponse.json({ ok: true });
}
