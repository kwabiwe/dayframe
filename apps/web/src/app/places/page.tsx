import { LibraryHead } from "@/components/library/LibraryHead";
import { PlacesManager } from "@/components/PlacesManager";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";
import { getViewerTimeZoneIfSent } from "@/lib/viewer-time-zone-server";

export const dynamic = "force-dynamic";

export default async function PlacesPage() {
  const session = await resolvePageSession();
  const data = await getBootstrapData(session, { timeZone: await getViewerTimeZoneIfSent() });

  return (
    <div className="df-library">
      <LibraryHead current="/places" />
      <PlacesManager learnedPlaces={data.learnedPlaces} places={data.places} />
    </div>
  );
}
