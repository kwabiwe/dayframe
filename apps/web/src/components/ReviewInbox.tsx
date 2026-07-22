"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleSlash, GitMerge, Map, WandSparkles } from "lucide-react";
import type { ReviewItemRow } from "@/lib/queries";
import { formatDate, formatEventLabel, formatSourceLabel, formatTime } from "@/lib/format";
import { LocationReviewPanel } from "@/components/location/LocationReviewPanel";
import { clientFetch } from "@/lib/client-auth-fetch";

export function ReviewInbox({
  items,
  categories
}: {
  items: ReviewItemRow[];
  categories: Array<{ id: string; name: string }>;
}) {
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
          <ReviewItemCard
            key={item.id}
            item={item}
            adjacentReviewItemId={adjacentV2StayReviewId(item, openItems)}
            categories={categories}
          />
        ))}
      </div>
    </section>
  );
}

function ReviewItemCard({
  item,
  adjacentReviewItemId,
  categories
}: {
  item: ReviewItemRow;
  adjacentReviewItemId?: string;
  categories: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showEvidence, setShowEvidence] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const display = reviewItemDisplay(item);

  async function act(action: string) {
    setActiveAction(action);
    setActionError(null);
    try {
      const body = hasV2Evidence(item)
        ? action === "accept"
          ? { action: "confirm" }
          : action === "ignore_once"
            ? { action: "ignore_once_location" }
            : { action }
        : { action };
      const response = await clientFetch(`/api/review/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({})) as { error?: string; message?: string };
        setActionError(responseBody.message ?? responseBody.error ?? "Unable to update this review item.");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setActiveAction(null);
    }
  }

  return (
    <article className="motion-row p-4">
      <div className="min-w-0">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{display.title}</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {display.meta}
            </p>
          </div>
          <span className="industrial-chip shrink-0 text-xs">{item.confidence}</span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="industrial-chip">{formatSourceLabel(item.eventSource ?? "review")}</span>
          <span className="industrial-chip">{display.kind}</span>
          <span className="industrial-chip tabular">
            {formatDate(item.createdAt)} {formatTime(item.createdAt)}
          </span>
        </div>

        {item.notes && !hasV2Evidence(item) ? (
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">{item.notes}</p>
        ) : null}
        {actionError ? <p className="mt-3 text-sm text-[var(--danger)]" role="alert">{actionError}</p> : null}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
          {hasV2Evidence(item) ? (
            <button
              className="industrial-button focus-ring min-h-11 whitespace-nowrap px-3 py-2 text-sm"
              type="button"
              aria-expanded={showEvidence}
              onClick={() => setShowEvidence((visible) => !visible)}
            >
              <Map size={15} />
              {showEvidence ? "Hide evidence" : "View evidence"}
            </button>
          ) : null}
          <button
            className="industrial-button-primary focus-ring min-h-11 whitespace-nowrap px-3 py-2 text-sm disabled:opacity-50"
            type="button"
            disabled={isPending || activeAction != null}
            onClick={() => act("accept")}
          >
            <Check size={15} />
            Accept
          </button>
          <button
            className="industrial-button focus-ring min-h-11 whitespace-nowrap px-3 py-2 text-sm disabled:opacity-50"
            type="button"
            disabled={isPending || activeAction != null}
            onClick={() => act("ignore_once")}
          >
            <CircleSlash size={15} />
            Ignore
          </button>
          {!hasV2Evidence(item) ? (
            <>
              <button
                className="industrial-button focus-ring min-h-11 whitespace-nowrap px-3 py-2 text-sm disabled:opacity-50"
                type="button"
                disabled={isPending || activeAction != null}
                onClick={() => act("always_ignore_source")}
              >
                <GitMerge size={15} />
                Always ignore
              </button>
              <button
                className="industrial-button focus-ring min-h-11 whitespace-nowrap px-3 py-2 text-sm disabled:opacity-50"
                type="button"
                disabled={isPending || activeAction != null}
                onClick={() => act("create_rule")}
              >
                <WandSparkles size={15} />
                Make rule
              </button>
            </>
          ) : null}
        </div>
        {showEvidence ? (
          <LocationReviewPanel
            reviewItemId={item.id}
            adjacentReviewItemId={adjacentReviewItemId}
            categories={categories}
            initialCategoryId={item.suggestedCategoryId}
            onClose={() => setShowEvidence(false)}
          />
        ) : null}
      </div>
    </article>
  );
}

function hasV2Evidence(item: ReviewItemRow) {
  return item.eventSource === "location_learning" &&
    (item.rawPayload?.algorithmVersion === "location-v2.0" || typeof item.rawPayload?.clientSegmentId === "string");
}

function adjacentV2StayReviewId(item: ReviewItemRow, candidates: ReviewItemRow[]) {
  if (!hasV2Evidence(item) || item.eventType === "commute_detected") return undefined;
  const itemStart = Date.parse(String(item.suggestedStartedAt ?? ""));
  const itemStop = Date.parse(String(item.suggestedStoppedAt ?? ""));
  if (!Number.isFinite(itemStart) || !Number.isFinite(itemStop)) return undefined;
  const maximumAdjacentGapMs = 15 * 60_000;
  return candidates
    .flatMap((candidate) => {
      if (candidate.id === item.id || !hasV2Evidence(candidate) || candidate.eventType === "commute_detected") return [];
      const candidateStart = Date.parse(String(candidate.suggestedStartedAt ?? ""));
      const candidateStop = Date.parse(String(candidate.suggestedStoppedAt ?? ""));
      if (!Number.isFinite(candidateStart) || !Number.isFinite(candidateStop)) return [];
      const gap = Math.min(Math.abs(candidateStart - itemStop), Math.abs(itemStart - candidateStop));
      return gap <= maximumAdjacentGapMs ? [{ id: candidate.id, gap }] : [];
    })
    .sort((a, b) => a.gap - b.gap || a.id.localeCompare(b.id))[0]?.id;
}

function reviewItemDisplay(item: ReviewItemRow) {
  const evidenceKind = typeof item.rawPayload?.evidenceKind === "string" ? item.rawPayload.evidenceKind : null;
  const eventType = item.eventType ?? item.type;
  const kind =
    eventType === "commute_detected"
      ? "Commute suggestion"
      : eventType === "learned_place_visit" || eventType === "geofence_exit" || evidenceKind === "learned_place"
        ? "Detected visit"
        : formatEventLabel(eventType);
  const title = kind === "Detected visit" && item.placeName
    ? `Detected visit to ${item.placeName}`
    : kind === "Commute suggestion"
      ? "Commute suggestion"
      : item.title;
  const meta = [
    item.categoryName ?? "Needs category",
    item.placeName ?? "No place",
    reviewTimeWindow(item),
    kind
  ]
    .filter((part, index, parts) => part && parts.indexOf(part) === index)
    .join(" / ");
  return { kind, meta, title };
}

function reviewTimeWindow(item: ReviewItemRow) {
  if (!item.suggestedStartedAt) return null;
  const start = new Date(item.suggestedStartedAt);
  const stop = item.suggestedStoppedAt ? new Date(item.suggestedStoppedAt) : null;
  if (Number.isNaN(start.getTime())) return null;
  if (!stop || Number.isNaN(stop.getTime())) return `${formatDate(start)} ${formatTime(start)}`;
  const durationMinutes = Math.max(1, Math.round((stop.getTime() - start.getTime()) / 60_000));
  return `${formatDate(start)} ${formatTime(start)}–${formatTime(stop)} · ${durationMinutes} min`;
}
