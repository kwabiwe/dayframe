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
