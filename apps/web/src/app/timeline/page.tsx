import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { TimeReviewViews } from "@/components/TimeReviewViews";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";
import {
  TIMELINE_PREFERENCE_COOKIE,
  timelineHref,
  firstVisitTimelinePreference,
  timelinePreferenceFromCookieValue,
  timelineSearchString,
  timelineStateFromSearchParams
} from "@/lib/timeline-view";
import { zonedDateKey } from "@/lib/viewer-time-zone";
import { getViewerTimeZone } from "@/lib/viewer-time-zone-server";

export const dynamic = "force-dynamic";

export default async function TimelinePage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await resolvePageSession();
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const preference = timelinePreferenceFromCookieValue(
    cookieStore.get(TIMELINE_PREFERENCE_COOKIE)?.value
  );
  const renderedAt = new Date();
  // Today in the viewer's zone (the app shell's cookie; UTC without it): the date a bare /timeline
  // opens, and the server's best guess at "today" for the first render. The browser replaces the
  // guess with its own clock after hydration.
  const todayKey = zonedDateKey(renderedAt, await getViewerTimeZone());
  // A first visit from a phone opens Day (no cookie yet); the user's own choice wins once made.
  const statePreference = preference ?? firstVisitTimelinePreference((await headers()).get("user-agent"));
  const state = timelineStateFromSearchParams(params, { preference: statePreference, today: todayKey });
  const currentSearch = timelineSearchString(params);
  const currentHref = currentSearch ? `/timeline?${currentSearch}` : "/timeline";
  const canonicalHref = timelineHref(params, state);
  if (currentHref !== canonicalHref) redirect(canonicalHref);
  const data = await getBootstrapData(session, { selectedDate: state.date });

  return (
    <div className="timeline-page">
      <TimeReviewViews
        initialData={data}
        initialPreference={preference}
        initialTodayKey={todayKey}
        renderedAt={renderedAt.toISOString()}
      />
    </div>
  );
}
