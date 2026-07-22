"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, GitMerge, MapPin, Scissors, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { LocationReviewAction, LocationReviewEvidenceDto } from "@dayframe/shared";
import { clientFetch } from "@/lib/client-auth-fetch";

const LocationEvidenceMap = dynamic(
  () => import("./LocationEvidenceMap").then((module) => module.LocationEvidenceMap),
  {
    ssr: false,
    loading: () => <p className="rounded-2xl bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">Loading private map…</p>
  }
);

export function LocationReviewPanel({
  reviewItemId,
  adjacentReviewItemId,
  categories,
  initialCategoryId,
  onClose
}: {
  reviewItemId: string;
  adjacentReviewItemId?: string;
  categories: Array<{ id: string; name: string }>;
  initialCategoryId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [evidence, setEvidence] = useState<LocationReviewEvidenceDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [placeName, setPlaceName] = useState("");
  const [selectedPoint, setSelectedPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? "");
  const [startedAt, setStartedAt] = useState("");
  const [stoppedAt, setStoppedAt] = useState("");

  useEffect(() => {
    let cancelled = false;
    void clientFetch(`/api/review/${reviewItemId}/location-evidence`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? "Unable to load location evidence.");
        }
        return response.json() as Promise<LocationReviewEvidenceDto>;
      })
      .then((next) => {
        if (cancelled) return;
        setEvidence(next);
        setDescription(next.display.title);
        setStartedAt(toLocalDateTimeInput(next.segment.startedAt));
        setStoppedAt(next.segment.stoppedAt ? toLocalDateTimeInput(next.segment.stoppedAt) : "");
        if (next.map.centre) {
          setSelectedPoint({ longitude: next.map.centre.coordinates[0], latitude: next.map.centre.coordinates[1] });
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load location evidence.");
        }
      });
    return () => { cancelled = true; };
  }, [reviewItemId]);

  async function act(action: LocationReviewAction) {
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await clientFetch(`/api/review/${reviewItemId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string; error?: string };
        setError(body.message ?? body.error ?? "Unable to update this location review.");
        return;
      }
      startTransition(() => router.refresh());
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }

  const actionsDisabled = isPending || isSubmitting;

  return (
    <div className="mt-4 max-h-[min(78vh,760px)] overflow-y-auto rounded-2xl bg-[var(--surface-muted)] p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Private location evidence</p>
          <h4 className="mt-1 text-base font-semibold">{evidence?.display.title ?? "Loading evidence…"}</h4>
        </div>
        <button className="industrial-icon-button focus-ring min-h-11 min-w-11" type="button" onClick={onClose} aria-label="Close location evidence">
          <X size={18} />
        </button>
      </div>

      {error ? <p className="mt-3 rounded-xl bg-[var(--danger-soft)] p-3 text-sm" role="alert">{error}</p> : null}
      {!evidence && !error ? <p className="mt-4 text-sm text-[var(--muted)]" role="status">Loading map and boundary evidence…</p> : null}
      {evidence ? (
        <div className="mt-4 space-y-4">
          <LocationEvidenceMap evidence={evidence} onSelectPoint={setSelectedPoint} />
          <section className="rounded-2xl bg-[var(--surface)] p-4">
            <h5 className="font-semibold">Time and uncertainty</h5>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {formatDateTime(evidence.segment.startedAt)}–{evidence.segment.stoppedAt ? formatDateTime(evidence.segment.stoppedAt) : "ongoing"}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {evidence.segment.continuityStatus === "uncertain_gap"
                ? "A gap limits precision, so Dayframe kept supported bounds instead of inventing an exact transition."
                : "The nearest arrival and departure evidence supports these boundaries."}
            </p>
            {evidence.map.gaps.map((gap) => (
              <p key={`${gap.startedAt}-${gap.stoppedAt}`} className="mt-2 text-sm text-[var(--warning)]">
                Evidence gap · {Math.round(gap.durationSeconds / 60)} minutes
              </p>
            ))}
          </section>

          {evidence.map.nearbySavedPlaces.length ? (
            <section className="rounded-2xl bg-[var(--surface)] p-4">
              <h5 className="font-semibold">Correct the place</h5>
              <p className="mt-1 text-sm text-[var(--muted)]">A correction influences future matching without widening the saved radius.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {evidence.map.nearbySavedPlaces.map((place) => (
                  <button
                    key={place.id}
                    className="industrial-button focus-ring min-h-11 px-3 text-sm"
                    disabled={actionsDisabled}
                    type="button"
                    onClick={() => void act({ action: "change_place_and_confirm", placeId: place.id, learnedPlaceId: null })}
                  >
                    <MapPin size={15} /> Use {place.name} and confirm
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {evidence.segment.kind === "stay" ? (
            <section className="rounded-2xl bg-[var(--surface)] p-4">
              <h5 className="font-semibold">Save this place</h5>
              <p className="mt-1 text-sm text-[var(--muted)]">Click the map to correct its centre. New places start with a bounded 80 metre radius.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  className="industrial-input focus-ring min-h-11 flex-1"
                  maxLength={120}
                  placeholder="Place name"
                  value={placeName}
                  onChange={(event) => setPlaceName(event.target.value)}
                />
                <button
                  className="industrial-button-primary focus-ring min-h-11 px-4 text-sm"
                  disabled={actionsDisabled || !placeName.trim() || !selectedPoint}
                  type="button"
                  onClick={() => selectedPoint && void act({
                    action: "save_place_and_confirm",
                    name: placeName.trim(),
                    latitude: selectedPoint.latitude,
                    longitude: selectedPoint.longitude,
                    radiusMeters: 80
                  })}
                >
                  Save place and confirm
                </button>
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl bg-[var(--surface)] p-4">
            <h5 className="font-semibold">Resolve</h5>
            <label className="mt-3 block text-sm font-medium" htmlFor={`location-category-${reviewItemId}`}>Category</label>
            <select
              id={`location-category-${reviewItemId}`}
              className="industrial-input focus-ring mt-1 min-h-11 w-full"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">No category</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <label className="mt-3 block text-sm font-medium" htmlFor={`location-description-${reviewItemId}`}>Description</label>
            <input
              id={`location-description-${reviewItemId}`}
              className="industrial-input focus-ring mt-1 min-h-11 w-full"
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Start
                <input
                  className="industrial-input focus-ring mt-1 min-h-11 w-full"
                  type="datetime-local"
                  value={startedAt}
                  onChange={(event) => setStartedAt(event.target.value)}
                />
              </label>
              <label className="text-sm font-medium">
                End
                <input
                  className="industrial-input focus-ring mt-1 min-h-11 w-full"
                  type="datetime-local"
                  value={stoppedAt}
                  onChange={(event) => setStoppedAt(event.target.value)}
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="industrial-button-primary focus-ring min-h-11 px-4 text-sm"
                disabled={actionsDisabled}
                type="button"
                onClick={() => void act({
                  action: "edit_and_confirm",
                  edit: {
                    categoryId: categoryId || null,
                    description,
                    ...(startedAt ? { startedAt: new Date(startedAt).toISOString() } : {}),
                    ...(stoppedAt ? { stoppedAt: new Date(stoppedAt).toISOString() } : {})
                  }
                })}
              >
                <Check size={15} /> Confirm edits
              </button>
              <button
                className="industrial-button focus-ring min-h-11 px-4 text-sm"
                disabled={actionsDisabled}
                type="button"
                onClick={() => void act({ action: "record_once", edit: { description } })}
              >
                Record once
              </button>
              {evidence.suggestedSplitPoints.map((split) => (
                <button
                  key={split.at}
                  className="industrial-button focus-ring min-h-11 px-4 text-sm"
                  disabled={actionsDisabled}
                  type="button"
                  onClick={() => void act({ action: "split", splitAt: split.at })}
                >
                  <Scissors size={15} /> Split near {formatTime(split.at)}
                </button>
              ))}
              {adjacentReviewItemId && evidence.segment.kind === "stay" ? (
                <button
                  className="industrial-button focus-ring min-h-11 px-4 text-sm"
                  disabled={actionsDisabled}
                  type="button"
                  onClick={() => void act({
                    action: "merge",
                    adjacentReviewItemId,
                    acknowledgeContradictoryEvidence: false
                  })}
                >
                  <GitMerge size={15} /> Merge adjacent
                </button>
              ) : null}
            </div>
          </section>
          <p className="text-xs leading-5 text-[var(--muted)]">
            {evidence.evidenceExpired
              ? "Raw evidence has expired; the derived segment remains."
              : evidence.evidenceExpiresAt
                ? `Raw evidence is retained until ${formatDateTime(evidence.evidenceExpiresAt)}.`
                : "No raw evidence retention date is available."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function toLocalDateTimeInput(value: string) {
  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
