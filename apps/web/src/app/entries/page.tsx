import { PageHeader } from "@/components/PageHeader";
import { EntriesTable } from "@/components/EntriesTable";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function EntriesPage() {
  const data = await getBootstrapData();

  return (
    <>
      <PageHeader
        title="Time entries"
        description="Filter, create, edit and delete time entries while keeping source confidence and review status visible."
      />
      <div className="px-5 py-6 md:px-8">
        <EntriesTable
          entries={data.entries}
          projects={data.projects}
          categories={data.categories}
          places={data.places}
        />
      </div>
    </>
  );
}
