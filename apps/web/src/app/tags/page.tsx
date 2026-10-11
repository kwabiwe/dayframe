import { LibraryHead } from "@/components/library/LibraryHead";
import { TagManager } from "@/components/TagManager";
import { resolvePageSession } from "@/lib/auth/server";
import { getTags } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
  const session = await resolvePageSession();
  const tags = await getTags(session);

  return (
    <div className="df-library">
      <LibraryHead current="/tags" />
      <TagManager tags={tags} />
    </div>
  );
}
