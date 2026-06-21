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
        <ReviewInbox items={data.reviewItems} />
        <section className="industrial-panel-strong p-4">
          <h2 className="text-base font-semibold">Correction model</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Accepted review items create confirmed time entries from the underlying activity event.
            Split, merge and saved-place correction flows are documented for the next phase in the README.
          </p>
        </section>
      </div>
    </>
  );
}
