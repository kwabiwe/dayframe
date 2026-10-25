import {
  getIntegrationVisits,
  INTEGRATION_VISITS_DEFAULT_LIMIT,
  INTEGRATION_VISITS_MAX_LIMIT,
  INTEGRATION_VISITS_MAX_RANGE_DAYS
} from "@/lib/integration-location";
import { IntegrationParamError, integrationGet, intParam, rangeParams } from "@/lib/integration-route";
import { decodeIntegrationTimeCursor } from "@/lib/integration-time";

/** Stays at saved places in a range (docs/integration-api.md › Known-place visits). */
export async function GET(request: Request) {
  return integrationGet(request, ["location:read"], "Unable to load place visits.", (session, url) => {
    const range = rangeParams(url, INTEGRATION_VISITS_MAX_RANGE_DAYS);
    const cursorValue = url.searchParams.get("cursor");
    const cursor = decodeIntegrationTimeCursor(cursorValue);
    if (cursorValue && !cursor) throw new IntegrationParamError("Use a valid pagination cursor.");
    return getIntegrationVisits(session, {
      ...range,
      cursor: cursor ?? null,
      limit: intParam(url, "limit", INTEGRATION_VISITS_DEFAULT_LIMIT, 1, INTEGRATION_VISITS_MAX_LIMIT)
    });
  });
}
