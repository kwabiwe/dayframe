import { LibraryHead } from "@/components/library/LibraryHead";
import { PlacesManager } from "@/components/PlacesManager";
import { resolvePageSession } from "@/lib/auth/server";
import { getArchivedPlaces, getBootstrapData } from "@/lib/queries";
import { getViewerTimeZoneIfSent } from "@/lib/viewer-time-zone-server";

export const dynamic = "force-dynamic";

export default async function PlacesPage() {
  const session = await resolvePageSession();
  const [data, archivedPlaces] = await Promise.all([
    getBootstrapData(session, { timeZone: await getViewerTimeZoneIfSent() }),
    getArchivedPlaces(session)
  ]);

  return (
    <div className="df-library">
      <LibraryHead current="/places" />
      <PlacesManager archivedPlaces={archivedPlaces} learnedPlaces={data.learnedPlaces} places={data.places} />
    </div>
  );
}
