import { PageHeader } from "@/components/PageHeader";
import { EntityForms } from "@/components/EntityForms";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await resolvePageSession();
  const data = await getBootstrapData(session);

  return (
    <>
      <PageHeader
        title="Categories"
        description="Manage the categories used by timers, quick actions and reports."
      />
      <div className="px-5 py-6 md:px-8">
        <EntityForms
          mode="projects"
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
