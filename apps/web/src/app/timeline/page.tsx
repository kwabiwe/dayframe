import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { TimeReviewViews } from "@/components/TimeReviewViews";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";
import {
  timelineHref,
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
  const state = timelineStateFromSearchParams(params);
  const currentSearch = timelineSearchString(params);
  const currentHref = currentSearch ? `/timeline?${currentSearch}` : "/timeline";
  const canonicalHref = timelineHref(params, state);
  if (currentHref !== canonicalHref) redirect(canonicalHref);
  const data = await getBootstrapData(session, { selectedDate: state.date });

  return (
    <>
      <PageHeader
        title="Timeline"
        description="Review time as calendar blocks, grouped entries and a weekly timesheet."
      />
      <div className="space-y-6 px-5 py-6 md:px-8">
        <TimeReviewViews initialData={data} />
      </div>
    </>
  );
}
