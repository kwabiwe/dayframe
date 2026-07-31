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
  const state = timelineStateFromSearchParams(params, { preference });
  const currentSearch = timelineSearchString(params);
  const currentHref = currentSearch ? `/timeline?${currentSearch}` : "/timeline";
  const canonicalHref = timelineHref(params, state);
  if (currentHref !== canonicalHref) redirect(canonicalHref);
  const data = await getBootstrapData(session, { selectedDate: state.date });

  return (
    <div className="timeline-page">
      <h1 className="sr-only">Timeline</h1>
      <TimeReviewViews initialData={data} initialPreference={preference} />
    </div>
  );
}
