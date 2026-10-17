import { ReviewDeck } from "@/components/review/ReviewDeck";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";
import { getViewerTimeZoneIfSent } from "@/lib/viewer-time-zone-server";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const session = await resolvePageSession();
  const data = await getBootstrapData(session, { timeZone: await getViewerTimeZoneIfSent() });

  return <ReviewDeck key={data.workspace.id} initialData={data} />;
}
