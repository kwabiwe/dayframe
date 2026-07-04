import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { archiveCategory, createCategory, updateCategory } from "@/lib/event-service";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { getBootstrapData } from "@/lib/queries";

const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required."),
  color: z.string().trim().optional(),
  isPinned: z.coerce.boolean().optional()
});

const updateCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).optional(),
  color: z.string().trim().optional(),
  isPinned: z.coerce.boolean().optional()
});

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const data = await getBootstrapData(session);
    return NextResponse.json({ categories: data.categories });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = createCategorySchema.parse(await request.json());
    const category = await createCategory(body, session);
    return NextResponse.json({ ok: true, category }, { status: 201 });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = updateCategorySchema.parse(await request.json());
    const category = await updateCategory(body.id, body, session);
    if (!category) return NextResponse.json({ error: "Category not found." }, { status: 404 });
    return NextResponse.json({ ok: true, category });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const url = new URL(request.url);
    const id = z.string().uuid().parse(url.searchParams.get("id"));
    await archiveCategory(id, session);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
