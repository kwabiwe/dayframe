import { PageHeader } from "@/components/PageHeader";
import { TagManager } from "@/components/TagManager";
import { resolvePageSession } from "@/lib/auth/server";
import { getTags } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
  const session = await resolvePageSession();
  const tags = await getTags(session);

  return (
    <>
      <PageHeader title="Tags" description="Manage reusable secondary context for tracked tasks and time entries." />
      <div className="px-5 py-6 md:px-8">
        <TagManager tags={tags} />
      </div>
    </>
  );
}
