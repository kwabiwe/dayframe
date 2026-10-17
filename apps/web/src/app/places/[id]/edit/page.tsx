import { notFound } from "next/navigation";
import { PlaceEditorPage } from "@/components/PlaceEditorPage";
import { PlaceEditor } from "@/components/PlaceEditor";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";
import { getViewerTimeZoneIfSent } from "@/lib/viewer-time-zone-server";

export const dynamic = "force-dynamic";

export default async function EditPlacePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await resolvePageSession();
  const data = await getBootstrapData(session, { timeZone: await getViewerTimeZoneIfSent() });
  const { id } = await params;
  const place = data.places.find((candidate) => candidate.id === id);
  if (!place) notFound();

  return (
    <PlaceEditorPage
      subtitle="Changes apply to new visits. Past blocks stay as they are."
      title="Edit place"
    >
      <PlaceEditor
        categories={data.categories}
        mode="edit"
        place={place}
        places={data.places}
      />
    </PlaceEditorPage>
  );
}
