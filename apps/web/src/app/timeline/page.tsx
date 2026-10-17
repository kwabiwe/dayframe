import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TimeReviewViews } from "@/components/TimeReviewViews";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";
import {
  TIMELINE_PREFERENCE_COOKIE,
  timelineHref,
  timelinePreferenceFromCookieValue,
  timelineSearchString,
  timelineStateFromSearchParams
} from "@/lib/timeline-view";
import { zonedDateKey } from "@/lib/viewer-time-zone";
import { getViewerTimeZone, getViewerTimeZoneIfSent } from "@/lib/viewer-time-zone-server";

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
  const state = timelineStateFromSearchParams(params, { preference, today: todayKey });
  const currentSearch = timelineSearchString(params);
  const currentHref = currentSearch ? `/timeline?${currentSearch}` : "/timeline";
  const canonicalHref = timelineHref(params, state);
  if (currentHref !== canonicalHref) redirect(canonicalHref);
  // The week's and day's ranges follow the viewer's midnights when the browser sent its zone, so a
  // block just after local midnight is never cut from a past week (UTC server; follow-up to #367).
  const data = await getBootstrapData(session, { selectedDate: state.date, timeZone: await getViewerTimeZoneIfSent() });

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
