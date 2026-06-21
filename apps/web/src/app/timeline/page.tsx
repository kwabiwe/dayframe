import { PageHeader } from "@/components/PageHeader";
import { TimeReviewViews } from "@/components/TimeReviewViews";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function TimelinePage() {
  const data = await getBootstrapData();

  return (
    <>
      <PageHeader
        title="Timeline"
        description="Review time as calendar blocks, grouped entries and a weekly timesheet."
      />
      <div className="space-y-6 px-5 py-6 md:px-8">
        <TimeReviewViews
          entries={data.entries}
          projects={data.projects}
          categories={data.categories}
          places={data.places}
        />
      </div>
    </>
  );
}
