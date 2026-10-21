import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { PlaceRoleSchema } from "@dayframe/shared";
import { authErrorResponse } from "@/lib/api-errors";
import { MissingRequiredColumnError } from "@/lib/db";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { PlaceRoleConflictError, assignPlaceRole } from "@/lib/place-role-service";

const placeRoleSchema = z.object({
  role: PlaceRoleSchema,
  // The saved place that should hold the role, or null to leave the slot empty.
  placeId: z.string().uuid().nullable(),
  // Optional new name for the place that loses the role, e.g. "Previous home".
  previousPlaceName: z.string().trim().min(1).max(120).nullable().optional(),
  // "Replace the old place" (PRD D19 A10): archive the old holder when it is within 300 m.
  archivePrevious: z.boolean().optional()
});

export async function PUT(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = placeRoleSchema.parse(await request.json());
    const result = await assignPlaceRole(session, body);
    if (result.status === "place_not_found") {
      return NextResponse.json({ error: "Place not found." }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      role: body.role,
      placeId: result.placeId,
      previousPlaceId: result.previousPlaceId,
      ...(result.previousArchived !== undefined ? { previousArchived: result.previousArchived } : {})
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError) return NextResponse.json({ issues: error.issues }, { status: 400 });
    if (error instanceof PlaceRoleConflictError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof MissingRequiredColumnError) return NextResponse.json({ error: error.message }, { status: 500 });
    throw error;
  }
}
