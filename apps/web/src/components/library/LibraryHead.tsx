import Link from "next/link";
import type { ReactNode } from "react";
import { LIBRARY_TABS } from "@/lib/shell-nav";

/**
 * The Library page head (Blocks parity step 14): the title, one line of context and the
 * Activities · Tags · Places switch. The three stay separate pages, so the switch is links
 * (the current one marked with aria-current), drawn as the neutral segmented control.
 */
export function LibraryHead({ action, current }: { action?: ReactNode; current: (typeof LIBRARY_TABS)[number]["href"] }) {
  return (
    <div className="df-page-head">
      <div>
        <h1>Library</h1>
        <p>Activities, tags and places in one place. Pinned activities appear in quick start.</p>
      </div>
      <div className="df-page-head-actions">
        <nav className="df-seg" aria-label="Library">
          {LIBRARY_TABS.map((tab) => (
            <Link aria-current={tab.href === current ? "page" : undefined} href={tab.href} key={tab.href}>
              {tab.label}
            </Link>
          ))}
        </nav>
        {action}
      </div>
    </div>
  );
}
