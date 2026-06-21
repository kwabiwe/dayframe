import { NextResponse } from "next/server";
import { createEntity } from "@/lib/event-service";

export async function POST(request: Request) {
  const body = await request.json();
  await createEntity(String(body.entity), body.values ?? {});
  return NextResponse.json({ ok: true }, { status: 201 });
}
