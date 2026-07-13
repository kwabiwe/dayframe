import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { createPlace, createPlaceFromLearnedPlace, deletePlace, updatePlace } from "@/lib/event-service";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { getBootstrapData } from "@/lib/queries";

const placeFieldsSchema = z.object({
  name: z.string().trim().min(1, "Place name is required."),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  radiusMeters: z.number().int().min(25).max(2000).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  defaultCategoryId: z.string().uuid().nullable().optional(),
  defaultActivityDescription: z.string().trim().max(240).nullable().optional(),
  autoStart: z.boolean().optional()
});

const placeCreateSchema = placeFieldsSchema.extend({
  learnedPlaceId: z.string().uuid().optional(),
  radiusMeters: z.number().int().min(25).max(2000).default(100),
  priority: z.number().int().min(0).max(100).default(5)
});

const placeUpdateSchema = placeFieldsSchema.partial().extend({
  id: z.string().uuid()
});

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const data = await getBootstrapData(session);
    return NextResponse.json({ places: data.places });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = placeCreateSchema.parse(await request.json());
    const { learnedPlaceId, ...placeInput } = body;
    const place = learnedPlaceId
      ? await createPlaceFromLearnedPlace(learnedPlaceId, { ...placeInput, autoStart: false }, session)
      : await createPlace(
        {
          ...placeInput,
          autoStart: false
        },
        session
      );
    if (!place) return NextResponse.json({ error: "Learned place not found." }, { status: 404 });
    return NextResponse.json({ ok: true, place }, { status: 201 });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError) return NextResponse.json({ issues: error.issues }, { status: 400 });
    throw error;
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = placeUpdateSchema.parse(await request.json());
    const place = await updatePlace(
      body.id,
      {
        ...body,
        autoStart: false
      },
      session
    );
    if (!place) return NextResponse.json({ error: "Place not found." }, { status: 404 });
    return NextResponse.json({ ok: true, place });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError) return NextResponse.json({ issues: error.issues }, { status: 400 });
    throw error;
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const id = new URL(request.url).searchParams.get("id");
    const parsedId = z.string().uuid().parse(id);
    const place = await deletePlace(parsedId, session);
    if (!place) return NextResponse.json({ error: "Place not found." }, { status: 404 });
    return NextResponse.json({ ok: true, id: place.id });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError) return NextResponse.json({ issues: error.issues }, { status: 400 });
    throw error;
  }
}
