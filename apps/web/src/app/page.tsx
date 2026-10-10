import { LandingPage } from "@/components/LandingPage";
import { TodayView } from "@/components/today/TodayView";
import { getOptionalPageSession, isAuthenticatedPageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function TodayPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getOptionalPageSession();
  if (!isAuthenticatedPageSession(session)) return <LandingPage />;

  const params = searchParams ? await searchParams : {};
  const date = Array.isArray(params.date) ? params.date[0] : params.date;
  const data = await getBootstrapData(session, { selectedDate: date });

  return <TodayView key={`${data.workspace.id}:${data.dateRange.selectedDate}`} initialData={data} renderedAt={new Date().toISOString()} />;
}
