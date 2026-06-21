import { DashboardRealtime } from "@/components/DashboardRealtime";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = await getBootstrapData();

  return <DashboardRealtime initialData={data} />;
}
