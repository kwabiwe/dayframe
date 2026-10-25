import { integrationGet } from "@/lib/integration-route";
import { getIntegrationReviewSummary } from "@/lib/integration-summary";

/** How many Review cards are waiting, by kind; counts only (docs/integration-api.md › Review summary). */
export async function GET(request: Request) {
  return integrationGet(request, ["review:read"], "Unable to load the Review summary.", (session) =>
    getIntegrationReviewSummary(session));
}
