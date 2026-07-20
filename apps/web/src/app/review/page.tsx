import { PageHeader } from "@/components/PageHeader";
import { ReviewInbox } from "@/components/ReviewInbox";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const session = await resolvePageSession();
  const data = await getBootstrapData(session);

  return (
    <>
      <PageHeader
        title="Review"
        description="Accept suggestions, ignore noisy signals, or create an automation rule from a correction."
      />
      <div className="space-y-6 px-5 py-6 md:px-8">
        <ReviewInbox items={data.reviewItems} categories={data.categories} />
        <section className="industrial-panel-strong p-4">
          <h2 className="text-base font-semibold">Correction model</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Location evidence stays private to your account. Inspect boundaries, correct saved-place matches,
            split or merge contiguous visits, and confirm the result in one atomic update.
          </p>
        </section>
      </div>
    </>
  );
}
