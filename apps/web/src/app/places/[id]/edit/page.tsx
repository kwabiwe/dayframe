import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { PlaceEditor } from "@/components/PlaceEditor";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function EditPlacePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await resolvePageSession();
  const data = await getBootstrapData(session);
  const { id } = await params;
  const place = data.places.find((candidate) => candidate.id === id);
  if (!place) notFound();

  return (
    <>
      <PageHeader
        title="Edit place"
        description="Update the location and visit-suggestion defaults without changing existing time entries."
      />
      <div className="place-editor-page px-5 pb-8 md:px-8">
        <PlaceEditor
          categories={data.categories}
          mode="edit"
          place={place}
          places={data.places}
        />
      </div>
    </>
  );
}
