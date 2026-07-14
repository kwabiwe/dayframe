import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import {
  deleteLearnedPlace,
  resolveLearnedPlaceLocation,
  updateLearnedPlaceStatus
} from "@/lib/event-service";
import { resolveRequestSession } from "@/lib/ingest-auth";

const learnedPlaceUpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("ignored")
});

const locationAddressSchema = z.object({
  name: z.string().trim().max(160).nullable().optional(),
  street: z.string().trim().max(160).nullable().optional(),
  streetNumber: z.string().trim().max(40).nullable().optional(),
  district: z.string().trim().max(160).nullable().optional(),
  city: z.string().trim().max(160).nullable().optional(),
  subregion: z.string().trim().max(160).nullable().optional(),
  region: z.string().trim().max(160).nullable().optional(),
  postalCode: z.string().trim().max(40).nullable().optional(),
  formattedAddress: z.string().trim().max(320).nullable().optional()
});

const learnedPlaceResolutionSchema = z.object({
  id: z.string().uuid(),
  action: z.literal("resolve_location"),
  address: locationAddressSchema
});

const learnedPlacePatchSchema = z.union([learnedPlaceUpdateSchema, learnedPlaceResolutionSchema]);

export async function PATCH(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = learnedPlacePatchSchema.parse(await request.json());
    if ("action" in body) {
      const learnedPlace = await resolveLearnedPlaceLocation(body.id, body.address, session);
      if (!learnedPlace) return NextResponse.json({ error: "Learned place not found." }, { status: 404 });
      return NextResponse.json({ ok: true, learnedPlace });
    }
    const learnedPlace = await updateLearnedPlaceStatus(body.id, body.status, session);
    if (!learnedPlace) return NextResponse.json({ error: "Learned place not found." }, { status: 404 });
    return NextResponse.json({ ok: true, id: learnedPlace.id, status: body.status });
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
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    const learnedPlace = await deleteLearnedPlace(id, session);
    if (!learnedPlace) return NextResponse.json({ error: "Learned place not found." }, { status: 404 });
    return NextResponse.json({ ok: true, id: learnedPlace.id, status: "forgotten" });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError) return NextResponse.json({ issues: error.issues }, { status: 400 });
    throw error;
  }
}
