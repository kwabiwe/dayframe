import {parseLocationSyncDiagnostics, type LocationSyncEndpoint, type LocationSyncDiagnostics} from "@dayframe/shared";
import {MobileHttpResponseError} from "../mobile-network";
import {LocationReplayResponseSchema} from "@dayframe/shared";
import {mobileJsonRequest,InvalidMobileAcknowledgementError} from "../mobile-network";
export const LOCATION_SYNC_REQUEST_TIMEOUT_MS = 15_000;
export async function fetchLocationSync(
  input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1],
  timeoutMilliseconds = LOCATION_SYNC_REQUEST_TIMEOUT_MS,
  isCurrent?: () => boolean | Promise<boolean>
) {
  return mobileJsonRequest<Record<string,unknown> | null>(input,init,{
    handleAuthentication:false,timeoutMilliseconds,timeoutMessage:"Location sync request timed out.",isCurrent,
    validate:(body,response)=>{
      if(!response.ok) return body as Record<string,unknown>|null;
      if(String(input).endsWith("/replay")) return LocationReplayResponseSchema.parse(body);
      if(!body||typeof body!=="object"||!("ok" in body)||body.ok!==true||!("acknowledgedEvidenceIds" in body)||
        !Array.isArray(body.acknowledgedEvidenceIds)||!body.acknowledgedEvidenceIds.every(id=>typeof id==="string"&&id.length>0)) throw new InvalidMobileAcknowledgementError();
      return body as Record<string,unknown>;
    }
  });
}

/** Reads only the already-consumed body and correlation headers. Never consumes JSON twice. */
export function locationResponseDiagnostics(endpoint: LocationSyncEndpoint, response: Response, body: unknown) {
  const source = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const safe = parseLocationSyncDiagnostics(source, endpoint, response.status);
  const requestId = response.headers?.get("X-Dayframe-Request-Id");
  const duration = response.headers?.get("X-Dayframe-Duration-Ms");
  const headers = parseLocationSyncDiagnostics({requestId, durationMs: duration && /^\d{1,8}$/.test(duration) ? Number(duration) : undefined}, endpoint, response.status);
  return {...safe, ...(response.ok ? {code:"ok" as const, reason:"none" as const} : {}), ...(headers.requestId ? {requestId:headers.requestId} : {}),
    ...(headers.durationMs !== undefined ? {durationMs:headers.durationMs} : {})};
}
export class LocationHttpResponseError extends MobileHttpResponseError {
  constructor(readonly diagnostics: LocationSyncDiagnostics) {
    super(diagnostics.httpStatus ?? 0, "Location sync request failed.");
    this.name = "LocationHttpResponseError";
  }
}
