import {
  getIntegrationDrives,
  INTEGRATION_DRIVES_DEFAULT_DAYS,
  INTEGRATION_DRIVES_DEFAULT_LIMIT,
  INTEGRATION_DRIVES_MAX_DAYS,
  INTEGRATION_DRIVES_MAX_LIMIT
} from "@/lib/integration-location";
import { integrationGet, intParam } from "@/lib/integration-route";

/** Confirmed home-origin drives to saved places (docs/integration-api.md › Driving evidence). */
export async function GET(request: Request) {
  return integrationGet(request, ["location:read"], "Unable to load driving evidence.", (session, url) =>
    getIntegrationDrives(session, {
      days: intParam(url, "days", INTEGRATION_DRIVES_DEFAULT_DAYS, 1, INTEGRATION_DRIVES_MAX_DAYS),
      limit: intParam(url, "limit", INTEGRATION_DRIVES_DEFAULT_LIMIT, 1, INTEGRATION_DRIVES_MAX_LIMIT)
    }));
}
