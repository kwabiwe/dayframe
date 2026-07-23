import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { PlaceEditor } from "@/components/PlaceEditor";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function NewPlacePage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await resolvePageSession();
  const data = await getBootstrapData(session);
  const params = await searchParams;
  const learnedPlaceId = typeof params.learnedPlaceId === "string"
    ? params.learnedPlaceId
    : null;
  const learnedPlace = learnedPlaceId
    ? data.learnedPlaces.find((candidate) => candidate.id === learnedPlaceId)
    : null;
  if (learnedPlaceId && !learnedPlace) notFound();

  return (
    <>
      <PageHeader
        title={learnedPlace ? "Save learned place" : "New place"}
        description="Search first, then review the name, centre, radius and visit suggestions before saving."
      />
      <div className="place-editor-page px-5 pb-8 md:px-8">
        <PlaceEditor
          categories={data.categories}
          learnedPlace={learnedPlace}
          mode={learnedPlace ? "learned" : "create"}
          places={data.places}
        />
      </div>
    </>
  );
}
