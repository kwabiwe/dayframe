"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleSlash, GitMerge, WandSparkles } from "lucide-react";
import type { ReviewItemRow } from "@/lib/queries";
import { formatDate, formatEventLabel, formatSourceLabel, formatTime } from "@/lib/format";

export function ReviewInbox({ items }: { items: ReviewItemRow[] }) {
  const openItems = items.filter((item) => item.status === "open");

  return (
    <section className="industrial-panel">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-lg font-semibold">Review inbox</h2>
      </div>
      <div className="divide-y divide-[var(--line)]">
        {openItems.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--muted)]">No open review items.</p>
        ) : null}
        {openItems.map((item) => (
          <ReviewItemCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function ReviewItemCard({ item }: { item: ReviewItemRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function act(action: string) {
    await fetch(`/api/review/${item.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
    startTransition(() => router.refresh());
  }

  return (
    <article className="motion-row p-4">
      <div className="min-w-0">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{item.title}</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {item.projectName ?? "No project"} / {item.categoryName ?? "No category"} /{" "}
              {item.placeName ?? "No place"}
            </p>
          </div>
          <span className="industrial-chip shrink-0 text-xs">{item.confidence}</span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="industrial-chip">{formatSourceLabel(item.eventSource ?? "review")}</span>
          <span className="industrial-chip">{formatEventLabel(item.eventType ?? item.type)}</span>
          <span className="industrial-chip tabular">
            {formatDate(item.createdAt)} {formatTime(item.createdAt)}
          </span>
        </div>

        {item.notes ? (
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">{item.notes}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
          <button
            className="industrial-button-primary focus-ring min-h-9 whitespace-nowrap px-3 py-2 text-sm disabled:opacity-50"
            type="button"
            disabled={isPending}
            onClick={() => act("accept")}
          >
            <Check size={15} />
            Accept
          </button>
          <button
            className="industrial-button focus-ring min-h-9 whitespace-nowrap px-3 py-2 text-sm disabled:opacity-50"
            type="button"
            disabled={isPending}
            onClick={() => act("ignore_once")}
          >
            <CircleSlash size={15} />
            Ignore
          </button>
          <button
            className="industrial-button focus-ring min-h-9 whitespace-nowrap px-3 py-2 text-sm disabled:opacity-50"
            type="button"
            disabled={isPending}
            onClick={() => act("always_ignore_source")}
          >
            <GitMerge size={15} />
            Always ignore
          </button>
          <button
            className="industrial-button focus-ring min-h-9 whitespace-nowrap px-3 py-2 text-sm disabled:opacity-50"
            type="button"
            disabled={isPending}
            onClick={() => act("create_rule")}
          >
            <WandSparkles size={15} />
            Make rule
          </button>
        </div>
      </div>
    </article>
  );
}
