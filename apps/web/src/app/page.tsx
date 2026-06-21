import { DashboardRealtime } from "@/components/DashboardRealtime";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await resolvePageSession();
  const data = await getBootstrapData(session);

  return <DashboardRealtime initialData={data} />;
}
