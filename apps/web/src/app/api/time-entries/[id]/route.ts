import { NextResponse } from "next/server";
import { deleteTimeEntry, updateTimeEntry } from "@/lib/event-service";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json();
  await updateTimeEntry(id, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await deleteTimeEntry(id);
  return NextResponse.json({ ok: true });
}
