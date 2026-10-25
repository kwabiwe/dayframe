import { getIntegrationCurrentPlace } from "@/lib/integration-location";
import { integrationGet } from "@/lib/integration-route";
import { getIntegrationReviewSummary } from "@/lib/integration-summary";
import { getIntegrationTimeCurrentSnapshot } from "@/lib/integration-time";
import { hasScopes } from "@/lib/session";

/**
 * One poll for an assistant (docs/integration-api.md › Context): the running timer and today's total,
 * plus where the person is (`location:read`) and what waits in Review (`review:read`) when the token
 * holds those scopes. A section the token can't read is null and named in `omitted`.
 */
export async function GET(request: Request) {
  return integrationGet(request, ["time:read"], "Unable to load the context.", async (session) => {
    const location = hasScopes(session, ["location:read"]);
    const review = hasScopes(session, ["review:read"]);
    const [time, place, reviewSummary] = await Promise.all([
      getIntegrationTimeCurrentSnapshot(session),
      location ? getIntegrationCurrentPlace(session) : null,
      review ? getIntegrationReviewSummary(session) : null
    ]);
    return {
      ok: true,
      serverNow: time.serverNow,
      workspaceId: session.workspaceId,
      activeEntry: time.activeEntry,
      todaySeconds: time.todaySeconds,
      location: place,
      review: reviewSummary ? { openCards: reviewSummary.openCards, byKind: reviewSummary.byKind, oldestOpenAt: reviewSummary.oldestOpenAt } : null,
      omitted: [...(location ? [] : ["location"]), ...(review ? [] : ["review"])]
    };
  });
}
