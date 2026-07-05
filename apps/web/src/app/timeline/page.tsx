import { PageHeader } from "@/components/PageHeader";
import { TimeReviewViews } from "@/components/TimeReviewViews";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function TimelinePage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await resolvePageSession();
  const params = searchParams ? await searchParams : {};
  const date = Array.isArray(params.date) ? params.date[0] : params.date;
  const data = await getBootstrapData(session, { selectedDate: date });

  return (
    <>
      <PageHeader
        title="Timeline"
        description="Review time as calendar blocks, grouped entries and a weekly timesheet."
      />
      <div className="space-y-6 px-5 py-6 md:px-8">
        <TimeReviewViews key={`${data.workspace.id}:${data.dateRange.selectedDate}`} initialData={data} />
      </div>
    </>
  );
}
