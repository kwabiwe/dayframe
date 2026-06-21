import { NextResponse } from "next/server";
import { processActivityEvent } from "@/lib/event-service";

export async function POST(request: Request) {
  const body = await request.json();
  const result = await processActivityEvent(body);
  return NextResponse.json(result, { status: 201 });
}
