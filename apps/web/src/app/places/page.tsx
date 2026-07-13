import { PageHeader } from "@/components/PageHeader";
import { EntityForms } from "@/components/EntityForms";
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
        description="Create known places, tune radius and priority, and set default category and activity suggestions."
      />
      <div className="px-5 py-6 md:px-8">
        <EntityForms
          mode="places"
          categories={data.categories}
          learnedPlaces={data.learnedPlaces}
          places={data.places}
          automationRules={data.automationRules}
        />
      </div>
    </>
  );
}
