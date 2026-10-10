import { ReviewDeck } from "@/components/review/ReviewDeck";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const session = await resolvePageSession();
  const data = await getBootstrapData(session);

  return <ReviewDeck key={data.workspace.id} initialData={data} />;
}
