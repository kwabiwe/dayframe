import { DashboardRealtime } from "@/components/DashboardRealtime";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await resolvePageSession();
  const params = searchParams ? await searchParams : {};
  const date = Array.isArray(params.date) ? params.date[0] : params.date;
  const data = await getBootstrapData(session, { selectedDate: date });

  return <DashboardRealtime key={data.dateRange.selectedDate} initialData={data} />;
}
