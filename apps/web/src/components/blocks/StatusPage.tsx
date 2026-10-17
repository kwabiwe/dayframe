"use client";

import Link from "next/link";
import { startTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useInsideAppShell } from "@/components/AppShellRuntime";
import { DayframeBrand } from "@/components/brand/DayframeBrand";

/**
 * The one page for a missing page or a failure (web UI audit WUI-048, owner 17 Oct 2026): the
 * Dayframe lock-up, a title, one line of explanation and a neutral "Go to Today" pill, with an
 * optional action before it (Try again). Inside the signed-in shell, which already supplies the
 * page's <main>, it is a plain section; on a bare page it is the <main> itself (Codex r1 on #493).
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
  const insideShell = useInsideAppShell();
  const content = (
    <section aria-labelledby="df-status-title" className="df-card df-status-card">
      <DayframeBrand decorative size="md" />
      <h1 id="df-status-title">{title}</h1>
      <p>{explanation}</p>
      <div className="df-status-actions">
        {action}
        <Link className="df-rbtn" href="/">Go to Today</Link>
      </div>
    </section>
  );
  return insideShell
    ? <div className="df-status-page">{content}</div>
    : <main className="df-status-page">{content}</main>;
}

/**
 * Try again for a failed page: it fetches the page again, not only re-renders the failed answer
 * (Codex r1 on #493). Next's `unstable_retry` refreshes the route and resets the boundary;
 * without it, the same two steps by hand.
 */
export function useErrorRetry(reset: () => void, unstableRetry?: () => void) {
  const router = useRouter();
  return () => {
    if (unstableRetry) {
      unstableRetry();
      return;
    }
    startTransition(() => {
      router.refresh();
      reset();
    });
  };
}
