import { getIntegrationRoutes, INTEGRATION_DRIVES_DEFAULT_DAYS, INTEGRATION_DRIVES_MAX_DAYS, INTEGRATION_ROUTES_MIN_SAMPLES } from "@/lib/integration-location";
import { integrationGet, intParam } from "@/lib/integration-route";

/** Typical journey times between saved places, from confirmed trips (docs/integration-api.md › Route estimates). */
export async function GET(request: Request) {
  return integrationGet(request, ["location:read"], "Unable to load route estimates.", (session, url) =>
    getIntegrationRoutes(session, {
      days: intParam(url, "days", INTEGRATION_DRIVES_DEFAULT_DAYS, 1, INTEGRATION_DRIVES_MAX_DAYS),
      minSamples: intParam(url, "minSamples", INTEGRATION_ROUTES_MIN_SAMPLES, INTEGRATION_ROUTES_MIN_SAMPLES, 50)
    }));
}
