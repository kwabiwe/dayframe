import { PageHeader } from "@/components/PageHeader";
import { EntityForms } from "@/components/EntityForms";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const data = await getBootstrapData();

  return (
    <>
      <PageHeader
        title="Projects"
        description="Configure clients, projects, categories and tags without hard-coded personal routines."
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
