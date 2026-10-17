import Link from "next/link";
import type { ReactNode } from "react";
import { DayframeBrand } from "@/components/brand/DayframeBrand";

/**
 * The one page for a missing page or a failure (web UI audit WUI-048, owner 17 Oct 2026): the
 * Dayframe lock-up, a title, one line of explanation and a neutral "Go to Today" pill, with an
 * optional action before it (Try again). It sits inside the Blocks shell when signed in.
 */
export function StatusPage({
  action,
  explanation,
  title
}: {
  action?: ReactNode;
  explanation: string;
  title: string;
}) {
  return (
    <main className="df-status-page">
      <section aria-labelledby="df-status-title" className="df-card df-status-card">
        <DayframeBrand decorative size="md" />
        <h1 id="df-status-title">{title}</h1>
        <p>{explanation}</p>
        <div className="df-status-actions">
          {action}
          <Link className="df-rbtn" href="/">Go to Today</Link>
        </div>
      </section>
    </main>
  );
}
