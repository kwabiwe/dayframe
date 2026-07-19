import { TagMutationSchema } from "@dayframe/shared";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { createTag, listTags } from "@/lib/tag-service";

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const query = new URL(request.url).searchParams.get("q");
    return NextResponse.json({ tags: await listTags(session, query) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const input = TagMutationSchema.parse(await request.json());
    const tag = await createTag(input, session);
    return NextResponse.json({ ok: true, tag }, { status: 201 });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid tag." }, { status: 400 });
    }
    throw error;
  }
}
