import { CategoryManager } from "@/components/CategoryManager";
import { PageHeader } from "@/components/PageHeader";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const session = await resolvePageSession();
  const data = await getBootstrapData(session);

  return (
    <>
      <PageHeader
        title="Categories"
        description="Manage the categories used for timer starts, quick actions, review and reports."
      />
      <div className="px-5 py-6 md:px-8">
        <CategoryManager categories={data.categories} />
      </div>
    </>
  );
}
