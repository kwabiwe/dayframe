import { PageHeader } from "@/components/PageHeader";
import { EntityForms } from "@/components/EntityForms";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AutomationPage() {
  const session = await resolvePageSession();
  const data = await getBootstrapData(session);

  return (
    <>
      <PageHeader
        title="Automation"
        description="Define rules such as entering Gym, tapping NFC, or using a Shortcut without bypassing the activity-event ledger."
      />
      <div className="px-5 py-6 md:px-8">
        <EntityForms
          mode="automation"
          categories={data.categories}
          places={data.places}
          automationRules={data.automationRules}
        />
      </div>
    </>
  );
}
