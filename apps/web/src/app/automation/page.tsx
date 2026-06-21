import { PageHeader } from "@/components/PageHeader";
import { EntityForms } from "@/components/EntityForms";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AutomationPage() {
  const data = await getBootstrapData();

  return (
    <>
      <PageHeader
        title="Automation"
        description="Define rules such as entering Gym, tapping an NFC tag, or using a Shortcut without bypassing the activity-event ledger."
      />
      <div className="px-5 py-6 md:px-8">
        <EntityForms
          mode="automation"
          clients={data.clients}
          categories={data.categories}
          projects={data.projects}
          tags={data.tags}
          places={data.places}
          automationRules={data.automationRules}
        />
      </div>
    </>
  );
}
