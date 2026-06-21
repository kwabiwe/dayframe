import { NextResponse } from "next/server";
import { createEntity } from "@/lib/event-service";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function POST(request: Request) {
  const session = await resolveRequestSession(request);
  const body = await request.json();
  await createEntity(String(body.entity), body.values ?? {}, session);
  return NextResponse.json({ ok: true }, { status: 201 });
}
