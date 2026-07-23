import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import {
  getWebPlaceSearchProvider,
  PlaceSearchProviderError
} from "@/lib/place-search";

const placeSearchQuerySchema = z.object({
  q: z.string().transform((value) => value.trim()).pipe(z.string().min(2).max(160)),
  biasLat: optionalCoordinate(-90, 90),
  biasLon: optionalCoordinate(-180, 180),
  language: z.string().trim().regex(/^[a-z]{2}$/i).default("en")
}).superRefine((value, context) => {
  if ((value.biasLat === undefined) !== (value.biasLon === undefined)) {
    context.addIssue({
      code: "custom",
      message: "Both biasLat and biasLon are required when using a coordinate bias."
    });
  }
});

export async function GET(request: Request) {
  try {
    await resolveRequestSession(request);
    const url = new URL(request.url);
    const input = placeSearchQuerySchema.parse({
      q: url.searchParams.get("q") ?? "",
      biasLat: url.searchParams.get("biasLat") ?? undefined,
      biasLon: url.searchParams.get("biasLon") ?? undefined,
      language: url.searchParams.get("language") ?? "en"
    });
    const suggestions = await getWebPlaceSearchProvider().suggest({
      query: input.q,
      biasLat: input.biasLat,
      biasLon: input.biasLon,
      language: input.language,
      signal: request.signal
    });
    return privateJson({ suggestions });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return withPrivateNoStore(authResponse);
    if (error instanceof ZodError) {
      return privateJson({
        error: {
          code: "invalid_place_search",
          message: "Enter between 2 and 160 characters and use a valid search bias."
        }
      }, 400);
    }
    if (error instanceof PlaceSearchProviderError) {
      const timeout = error.code === "provider_timeout";
      return privateJson({
        error: {
          code: timeout ? "place_search_timeout" : "place_search_unavailable",
          message: timeout
            ? "Place search took too long. Try again, or use Current location or Advanced coordinates."
            : "Place search is unavailable. Use Current location or Advanced coordinates."
        }
      }, timeout ? 504 : 503);
    }
    throw error;
  }
}

function optionalCoordinate(minimum: number, maximum: number) {
  return z.preprocess(
    (value) => value === undefined ? undefined : Number(value),
    z.number().finite().min(minimum).max(maximum).optional()
  );
}

function privateJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store" }
  });
}

function withPrivateNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
