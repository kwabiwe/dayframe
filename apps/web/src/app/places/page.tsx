import Link from "next/link";
import { LibraryHead } from "@/components/library/LibraryHead";
import { PlacesManager } from "@/components/PlacesManager";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PlacesPage() {
  const session = await resolvePageSession();
  const data = await getBootstrapData(session);

  return (
    <div className="df-library">
      <LibraryHead
        action={(
          <Link className="df-rbtn df-rbtn--sm" href="/places/new">
            Add place
          </Link>
        )}
        current="/places"
      />
      <PlacesManager learnedPlaces={data.learnedPlaces} places={data.places} />
    </div>
  );
}
