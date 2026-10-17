import { ActivitiesLibrary } from "@/components/library/ActivitiesLibrary";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";
import { getViewerTimeZoneIfSent } from "@/lib/viewer-time-zone-server";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const session = await resolvePageSession();
  const data = await getBootstrapData(session, { timeZone: await getViewerTimeZoneIfSent() });

  return <ActivitiesLibrary key={data.workspace.id} initialData={data} />;
}
