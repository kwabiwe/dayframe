import { notFound } from "next/navigation";
import { PlaceRoleSchema, placeRoleLabel } from "@dayframe/shared";
import { PlaceEditorPage } from "@/components/PlaceEditorPage";
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
  const parsedRole = PlaceRoleSchema.safeParse(params.role);
  const role = parsedRole.success ? parsedRole.data : null;

  return (
    <PlaceEditorPage
      subtitle="Search for the place, check its centre and size, then save."
      title={role ? `Add ${placeRoleLabel(role)}` : learnedPlace ? "Save learned place" : "New place"}
    >
      <PlaceEditor
        categories={data.categories}
        learnedPlace={learnedPlace}
        mode={learnedPlace ? "learned" : "create"}
        places={data.places}
        role={role}
      />
    </PlaceEditorPage>
  );
}
