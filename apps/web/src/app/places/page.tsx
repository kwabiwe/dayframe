import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PlacesManager } from "@/components/PlacesManager";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PlacesPage() {
  const session = await resolvePageSession();
  const data = await getBootstrapData(session);

  return (
    <>
      <PageHeader
        title="Places"
        description="Save locations and choose whether detected visits should appear in Review."
        action={(
          <Link className="ui-button ui-button-primary" href="/places/new">
            <Plus aria-hidden="true" size={17} />
            Add place
          </Link>
        )}
      />
      <div className="px-5 pb-8 md:px-8">
        <PlacesManager learnedPlaces={data.learnedPlaces} places={data.places} />
      </div>
    </>
  );
}
