import { LibraryHead } from "@/components/library/LibraryHead";
import { PlacesManager } from "@/components/PlacesManager";
import { resolvePageSession } from "@/lib/auth/server";
import { getArchivedPlaces, getBootstrapData, getPlaceVisitStats } from "@/lib/queries";
import { getViewerTimeZoneIfSent } from "@/lib/viewer-time-zone-server";

export const dynamic = "force-dynamic";

export default async function PlacesPage() {
  const session = await resolvePageSession();
  const timeZone = await getViewerTimeZoneIfSent();
  const now = new Date();
  const [data, archivedPlaces, visits] = await Promise.all([
    getBootstrapData(session, { timeZone }),
    getArchivedPlaces(session),
    getPlaceVisitStats(session, now)
  ]);

  return (
    <div className="df-library">
      <LibraryHead current="/places" />
      <PlacesManager
        archivedPlaces={archivedPlaces}
        learnedPlaces={data.learnedPlaces}
        now={now.toISOString()}
        places={data.places}
        timeZone={timeZone}
        visits={visits}
      />
    </div>
  );
}
