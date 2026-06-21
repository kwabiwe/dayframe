import { NextResponse } from "next/server";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { getBootstrapData } from "@/lib/queries";

export async function GET(request: Request) {
  const session = await resolveRequestSession(request);
  const data = await getBootstrapData(session);
  return NextResponse.json(data);
}
