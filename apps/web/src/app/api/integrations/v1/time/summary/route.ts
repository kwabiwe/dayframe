import { IntegrationParamError, integrationGet } from "@/lib/integration-route";
import { getIntegrationTimeSummary } from "@/lib/integration-summary";

/** Logged time per London day or week, by category (docs/integration-api.md › Time summary). */
export async function GET(request: Request) {
  return integrationGet(request, ["time:read"], "Unable to load the time summary.", (session, url) => {
    const period = url.searchParams.get("period") ?? "day";
    if (period !== "day" && period !== "week") throw new IntegrationParamError("period must be day or week.");
    const date = url.searchParams.get("date");
    if (date != null && !validDate(date)) throw new IntegrationParamError("date must be a calendar date (YYYY-MM-DD).");
    return getIntegrationTimeSummary(session, { period, date });
  });
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
