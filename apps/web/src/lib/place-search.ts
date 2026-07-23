import { z } from "zod";

export const WEB_PLACE_SEARCH_MAX_RESULTS = 6;
export const WEB_PLACE_SEARCH_TIMEOUT_MS = 4_500;

export type WebPlaceSuggestion = {
  id: string;
  title: string;
  subtitle: string | null;
  formattedAddress: string | null;
  latitude: number;
  longitude: number;
  resultType: string | null;
};

export type PlaceSuggestInput = {
  query: string;
  biasLat?: number;
  biasLon?: number;
  language?: string;
  signal?: AbortSignal;
};

export interface WebPlaceSearchProvider {
  suggest(input: PlaceSuggestInput): Promise<WebPlaceSuggestion[]>;
}

export type PlaceSearchProviderErrorCode =
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_rejected"
  | "provider_failed"
  | "provider_invalid_response";

export class PlaceSearchProviderError extends Error {
  readonly code: PlaceSearchProviderErrorCode;

  constructor(code: PlaceSearchProviderErrorCode) {
    super(code);
    this.name = "PlaceSearchProviderError";
    this.code = code;
  }
}

type ProviderOptions = {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const geoapifyResultSchema = z.object({
  place_id: z.string().optional(),
  name: z.string().nullish(),
  address_line1: z.string().nullish(),
  address_line2: z.string().nullish(),
  formatted: z.string().nullish(),
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  result_type: z.string().nullish()
}).passthrough();

const geoapifyPayloadSchema = z.object({
  results: z.array(z.unknown())
}).passthrough();

export function getWebPlaceSearchProvider(): WebPlaceSearchProvider {
  const apiKey = process.env.GEOAPIFY_API_KEY?.trim();
  if (!apiKey) throw new PlaceSearchProviderError("provider_unavailable");
  return createGeoapifyPlaceSearchProvider({ apiKey });
}

export function createGeoapifyPlaceSearchProvider({
  apiKey,
  fetchImpl = fetch,
  timeoutMs = WEB_PLACE_SEARCH_TIMEOUT_MS
}: ProviderOptions): WebPlaceSearchProvider {
  return {
    async suggest(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
      const abortFromCaller = () => controller.abort("cancelled");
      input.signal?.addEventListener("abort", abortFromCaller, { once: true });

      try {
        const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
        url.searchParams.set("text", input.query);
        url.searchParams.set("format", "json");
        url.searchParams.set("limit", String(WEB_PLACE_SEARCH_MAX_RESULTS));
        url.searchParams.set("lang", input.language ?? "en");
        url.searchParams.set("apiKey", apiKey);
        if (isFiniteCoordinatePair(input.biasLat, input.biasLon)) {
          url.searchParams.set("bias", `proximity:${input.biasLon},${input.biasLat}`);
        } else {
          url.searchParams.set("bias", "countrycode:gb");
        }

        const response = await fetchImpl(url, {
          headers: { Accept: "application/json" },
          signal: controller.signal
        });
        if (response.status >= 400 && response.status < 500) {
          throw new PlaceSearchProviderError("provider_rejected");
        }
        if (!response.ok) throw new PlaceSearchProviderError("provider_failed");

        const payload = geoapifyPayloadSchema.safeParse(await response.json());
        if (!payload.success) {
          throw new PlaceSearchProviderError("provider_invalid_response");
        }

        return payload.data.results
          .map((result, index) => normalizeGeoapifyResult(result, index))
          .filter((result): result is WebPlaceSuggestion => result !== null)
          .slice(0, WEB_PLACE_SEARCH_MAX_RESULTS);
      } catch (error) {
        if (error instanceof PlaceSearchProviderError) throw error;
        if (controller.signal.aborted && !input.signal?.aborted) {
          throw new PlaceSearchProviderError("provider_timeout");
        }
        if (input.signal?.aborted) throw error;
        throw new PlaceSearchProviderError("provider_failed");
      } finally {
        clearTimeout(timeout);
        input.signal?.removeEventListener("abort", abortFromCaller);
      }
    }
  };
}

function normalizeGeoapifyResult(value: unknown, index: number): WebPlaceSuggestion | null {
  const parsed = geoapifyResultSchema.safeParse(value);
  if (!parsed.success) return null;

  const result = parsed.data;
  const formattedAddress = cleanText(result.formatted);
  const title = cleanText(result.name)
    ?? cleanText(result.address_line1)
    ?? formattedAddress;
  if (!title) return null;

  const subtitle = cleanText(result.address_line2)
    ?? (formattedAddress && formattedAddress !== title ? formattedAddress : null);
  return {
    id: cleanText(result.place_id)
      ?? `${result.lat.toFixed(6)}:${result.lon.toFixed(6)}:${index}`,
    title,
    subtitle,
    formattedAddress,
    latitude: result.lat,
    longitude: result.lon,
    resultType: cleanText(result.result_type)
  };
}

function cleanText(value: string | null | undefined) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function isFiniteCoordinatePair(latitude?: number, longitude?: number) {
  return typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180;
}
