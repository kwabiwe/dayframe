"use client";

import { formatClockTime, formatDuration, type ClockFormat } from "@dayframe/shared";
import { useEffect, useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  SAVE_PLACE_RADIUS_METERS, tripStopRows, tripStopsHeading, type LocationReviewAction, type LocationReviewEvidenceDto, type ReviewEntryEdit
} from "@dayframe/shared";
import { clientFetch } from "@/lib/client-auth-fetch";
import { CategoryPicker } from "@/components/CategoryPicker";
import { OverlapNotice } from "@/components/OverlapNotice";
import { useClockFormat } from "@/components/ClockFormat";
import { dateTimeLocalInputToIso } from "@/lib/format";
import { locationEvidenceRetentionLabel } from "@/lib/location/location-evidence-presentation";
import type { CategoryRow, TimeEntryRow } from "@/lib/queries";

const LocationEvidenceMap = dynamic(
  () => import("./LocationEvidenceMap").then((module) => module.LocationEvidenceMap),
  {
    ssr: false,
    loading: () => (
      <div className="location-evidence-loading" role="status">
        Loading private map…
      </div>
    )
  }
);

export function LocationReviewPanel({
  reviewItemId,
  adjacentReviewItemId,
  categories,
  entries,
  initialCategoryId,
  initialDescription,
  onClose,
  onResolved
}: {
  reviewItemId: string;
  adjacentReviewItemId?: string;
  categories: CategoryRow[];
  entries: TimeEntryRow[];
  initialCategoryId: string | null;
  /** A name chosen before opening (Review's "Log as"); otherwise the evidence title. */
  initialDescription?: string;
  onClose: () => void;
  /** A saved action (confirm, split, merge…): the suggestion as shown is no longer current. */
  onResolved?: () => void;
}) {
  const clock = useClockFormat();
  const router = useRouter();
  const [evidence, setEvidence] = useState<LocationReviewEvidenceDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [placeName, setPlaceName] = useState("");
  // "Save this place" (PRD D19, design §7): its size, and the place's visit switches.
  const [placeSize, setPlaceSize] = useState<keyof typeof SAVE_PLACE_RADIUS_METERS>("medium");
  const [suggestVisits, setSuggestVisits] = useState(true);
  const [placeAutoLog, setPlaceAutoLog] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  // Whether the person changed the name field: only then is a name "typed" (Codex r3 on #456).
  const [descriptionEdited, setDescriptionEdited] = useState(false);
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
        setDescription(initialDescription ?? initialEvidenceDescription(next));
        // A name carried in from the card's "Log as" field is one the person typed there (Codex r4 on #456).
        setDescriptionEdited(Boolean(initialDescription?.trim()));
        setStartedAt(toLocalDateTimeInput(next.segment.startedAt));
        setStoppedAt(next.segment.stoppedAt ? toLocalDateTimeInput(next.segment.stoppedAt) : "");
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load location evidence.");
        }
      });
    return () => { cancelled = true; };
  }, [initialDescription, loadAttempt, reviewItemId]);

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
      onResolved?.();
      startTransition(() => router.refresh());
      onClose();
    } catch {
      // A network failure keeps every field as it is (Codex r1 on #459).
      setError("Couldn't reach Dayframe. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  /** "Save place": saves where you were and keeps this card open with it, keeping every field here. */
  async function savePlace() {
    setError(null);
    setSaveStatus(null);
    setIsSubmitting(true);
    try {
      const name = placeName.trim();
      const response = await clientFetch(`/api/review/${reviewItemId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_place", name, radiusMeters: SAVE_PLACE_RADIUS_METERS[placeSize],
          categoryId: categoryId || null, suggestVisits, autoLog: suggestVisits && placeAutoLog
        } satisfies LocationReviewAction)
      });
      const body = await response.json().catch(() => ({})) as { message?: string; error?: string; rematchedCount?: number };
      if (!response.ok) {
        setError(body.message ?? body.error ?? "Couldn't save this place. Try again.");
        return;
      }
      setSaveStatus(savedPlaceStatus(name, body.rematchedCount ?? 0));
      setPlaceName("");
    } catch {
      // Nothing was saved that we know of: every field stays (Codex r1 on #459).
      setError("Couldn't reach Dayframe. Check your connection and try again.");
      return;
    } finally {
      setIsSubmitting(false);
    }
    // Saved: Review refreshes whatever happens next, and the card's evidence reloads without
    // touching the fields being edited (a failed reload keeps the shown evidence).
    startTransition(() => router.refresh());
    try {
      const reloaded = await clientFetch(`/api/review/${reviewItemId}/location-evidence`, { cache: "no-store" });
      if (reloaded.ok) setEvidence(await reloaded.json() as LocationReviewEvidenceDto);
    } catch {
      // The saved place shows once the panel is opened again.
    }
  }

  /** What the Resolve fields say, for Confirm edits and Save place and confirm. */
  function resolveEdit(): ReviewEntryEdit {
    return {
      categoryId: categoryId || null,
      description,
      ...typedMarker(description, descriptionEdited),
      ...(startedAt ? { startedAt: new Date(startedAt).toISOString() } : {}),
      ...(stoppedAt ? { stoppedAt: new Date(stoppedAt).toISOString() } : {})
    };
  }

  const actionsDisabled = isPending || isSubmitting;
  const stayCentre = evidence?.map.centre
    ? { longitude: evidence.map.centre.coordinates[0], latitude: evidence.map.centre.coordinates[1] }
    : null;

  return (
    <div className="location-review-panel mt-4 max-h-[min(78vh,760px)] overflow-y-auto rounded-2xl bg-[var(--surface-muted)] p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Private location evidence</p>
          <h4 className="mt-1 text-base font-semibold">{evidence?.display.title ?? "Loading evidence…"}</h4>
        </div>
        <button className="industrial-icon-button focus-ring min-h-11 min-w-11" type="button" onClick={onClose} aria-label="Close location evidence">
          <X size={18} />
        </button>
      </div>

      {error ? (
        <div className="location-review-error mt-3" role="alert">
          <span>{error}</span>
          {!evidence ? (
            <button
              className="industrial-button focus-ring min-h-11 px-3 text-sm"
              type="button"
              onClick={() => {
                setEvidence(null);
                setError(null);
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {!evidence && !error ? (
        <div className="location-review-loading mt-4" role="status">
          <strong>Loading evidence</strong>
          <span>Preparing the private map and supported time boundaries…</span>
        </div>
      ) : null}
      {evidence ? (
        <div className="mt-4 space-y-4">
          <LocationEvidenceMap evidence={evidence} />
          <section className="rounded-2xl bg-[var(--surface)] p-4">
            <h5 className="font-semibold">Time and uncertainty</h5>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {evidence.segment.approximateArrival ? "Approximate arrival · " : ""}
              {formatDateTime(evidence.segment.startedAt, clock)}–{evidence.segment.stoppedAt ? formatDateTime(evidence.segment.stoppedAt, clock) : "ongoing"}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {evidence.segment.approximateArrival
                ? "The arrival is estimated from location evidence. Its displayed duration is a suggestion, not confirmed stationary time."
                : evidence.segment.continuityStatus === "uncertain_gap"
                ? "A gap limits precision, so Dayframe kept supported bounds instead of inventing an exact transition."
                : "The nearest arrival and departure evidence supports these boundaries."}
            </p>
            {evidence.segment.kind === "commute" && tripStopsHeading(evidence.stops, evidence.segment.timeAway) ? (
              <div className="location-trip-stops mt-3">
                <p className="text-sm font-semibold">{tripStopsHeading(evidence.stops, evidence.segment.timeAway)}</p>
                <ul className="mt-1 divide-y divide-[var(--border)]">
                  {tripStopRows(evidence.stops, (value) => formatClockTime(value, clock)).map((row) => (
                    <li key={row.key} className="py-1.5 text-sm" aria-label={row.accessibilityLabel}>{row.label}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {evidence.map.gaps.map((gap) => (
              <p key={`${gap.startedAt}-${gap.stoppedAt}`} className="mt-2 text-sm text-[var(--warning)]">
                Evidence gap · {formatDuration(gap.durationSeconds)}
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
                    Use {place.name} and confirm
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {evidence.segment.kind === "stay" && !evidence.display.placeId && stayCentre ? (
            <section className="location-save-place rounded-2xl bg-[var(--surface)] p-4" aria-labelledby={`location-save-place-${reviewItemId}`}>
              <h5 className="font-semibold" id={`location-save-place-${reviewItemId}`}>Save this place</h5>
              <p className="mt-1 text-sm text-[var(--muted)]">The circle centres on where you were. It logs as the activity below.</p>
              <div className="mt-3 grid gap-3">
                <input
                  aria-label="Place name"
                  className="industrial-input focus-ring min-h-11"
                  maxLength={120}
                  placeholder="Place name"
                  value={placeName}
                  onChange={(event) => setPlaceName(event.target.value)}
                />
                {/* Native radios: arrow keys move between sizes, as in the place editor. */}
                <div aria-label="Place size" className="df-pe-seg" role="radiogroup">
                  {(Object.keys(SAVE_PLACE_RADIUS_METERS) as Array<keyof typeof SAVE_PLACE_RADIUS_METERS>).map((size) => (
                    <label key={size}>
                      <input
                        checked={placeSize === size}
                        name={`location-save-place-size-${reviewItemId}`}
                        onChange={() => setPlaceSize(size)}
                        type="radio"
                        value={size}
                      />
                      <span>{SAVE_PLACE_SIZE_LABELS[size]}</span>
                    </label>
                  ))}
                </div>
                <label className="place-suggestion-toggle">
                  <span>
                    <strong>Suggest visits here</strong>
                    <small>{suggestVisits ? "Show detected visits in Review." : "Do not suggest visits for this place."}</small>
                  </span>
                  <input
                    aria-label="Suggest visits here"
                    checked={suggestVisits}
                    role="switch"
                    type="checkbox"
                    onChange={(event) => {
                      setSuggestVisits(event.target.checked);
                      if (!event.target.checked) setPlaceAutoLog(false);
                    }}
                  />
                </label>
                <label className={`place-suggestion-toggle${suggestVisits ? "" : " is-disabled"}`}>
                  <span>
                    <strong>Log automatically</strong>
                    <small>{suggestVisits
                      ? "Visits here become blocks without a Review card."
                      : "Visits here become blocks without a Review card. Turn on Suggest visits here first."}</small>
                  </span>
                  <input
                    aria-label="Log automatically"
                    checked={suggestVisits && placeAutoLog}
                    disabled={!suggestVisits}
                    role="switch"
                    type="checkbox"
                    onChange={(event) => setPlaceAutoLog(event.target.checked)}
                  />
                </label>
                {/* The panel can be narrow (beside Review's queue): whole buttons wrap, never their labels. */}
                <div className="flex flex-wrap gap-2">
                  <button
                    className="industrial-button focus-ring min-h-11 whitespace-nowrap px-4 text-sm"
                    disabled={actionsDisabled || !placeName.trim()}
                    type="button"
                    onClick={() => void savePlace()}
                  >
                    Save place
                  </button>
                  <button
                    className="industrial-button-primary focus-ring min-h-11 whitespace-nowrap px-4 text-sm"
                    disabled={actionsDisabled || !placeName.trim()}
                    type="button"
                    onClick={() => void act({
                      action: "save_place_and_confirm",
                      name: placeName.trim(),
                      latitude: stayCentre.latitude,
                      longitude: stayCentre.longitude,
                      radiusMeters: SAVE_PLACE_RADIUS_METERS[placeSize],
                      suggestVisits,
                      autoLog: suggestVisits && placeAutoLog,
                      edit: resolveEdit()
                    })}
                  >
                    Save place and confirm
                  </button>
                </div>
              </div>
            </section>
          ) : null}
          {saveStatus ? <p className="location-save-place-status text-sm" role="status">{saveStatus}</p> : null}

          <section className="location-review-resolve rounded-2xl bg-[var(--surface)] p-4">
            <h5 className="font-semibold">Resolve</h5>
            <div className="location-review-resolve-grid mt-3">
              <label className="location-resolve-field" htmlFor={`location-description-${reviewItemId}`}>
                <span>Description</span>
                <input
                  id={`location-description-${reviewItemId}`}
                  className="location-resolve-control"
                  maxLength={500}
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setDescriptionEdited(true);
                  }}
                />
              </label>
              <CategoryPicker
                categories={categories}
                className="location-resolve-category"
                disabled={actionsDisabled}
                label="Activity"
                menuId={`location-category-${reviewItemId}-menu`}
                onOpenChange={setIsCategoryOpen}
                onSelect={setCategoryId}
                open={isCategoryOpen}
                portal
                selectedId={categoryId}
                triggerId={`location-category-${reviewItemId}`}
                variant="quick"
              />
              <label className="location-resolve-field">
                <span>Start</span>
                <input
                  aria-label="Start"
                  className="location-resolve-control tabular"
                  type="datetime-local"
                  value={startedAt}
                  onChange={(event) => setStartedAt(event.target.value)}
                />
              </label>
              <label className="location-resolve-field">
                <span>End</span>
                <input
                  aria-label="End"
                  className="location-resolve-control tabular"
                  type="datetime-local"
                  value={stoppedAt}
                  onChange={(event) => setStoppedAt(event.target.value)}
                />
              </label>
            </div>
            <div className="mt-3">
              <OverlapNotice
                candidate={{
                  startedAt: dateTimeLocalInputToIso(startedAt) ?? "invalid",
                  stoppedAt: dateTimeLocalInputToIso(stoppedAt)
                }}
                entries={entries}
              />
            </div>
            <div className="location-review-resolve-actions mt-3">
              <button
                className="industrial-button-primary focus-ring min-h-11 px-4 text-sm"
                disabled={actionsDisabled}
                type="button"
                onClick={() => void act({ action: "edit_and_confirm", edit: resolveEdit() })}
              >
                <Check size={15} /> Confirm edits
              </button>
              <button
                className="industrial-button focus-ring min-h-11 px-4 text-sm"
                disabled={actionsDisabled}
                type="button"
                onClick={() => void act({ action: "record_once", edit: { description, ...typedMarker(description, descriptionEdited) } })}
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
                  Split near {formatClockTime(split.at, clock)}
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
                  Merge adjacent
                </button>
              ) : null}
            </div>
          </section>
          <p className="text-xs leading-5 text-[var(--muted)]">
            {locationEvidenceRetentionLabel(evidence, clock)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** "12 Oct, 09:00" or "12 Oct, 9:00 AM": the day in the browser's language, the time in Dayframe's format (PRD D18). */
function formatDateTime(value: string, clock: ClockFormat) {
  const date = new Date(value);
  return `${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date)}, ${formatClockTime(date, clock)}`;
}

function toLocalDateTimeInput(value: string) {
  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/**
 * The editor's starting name: a Move starts empty (its block shows its activity, PRD D19), and so does
 * a stay Dayframe could not name; otherwise the suggestion's title (Codex r1 on #456).
 */
export function initialEvidenceDescription(evidence: Pick<LocationReviewEvidenceDto, "segment" | "display">) {
  if (evidence.segment.kind === "commute") return "";
  const title = evidence.display.title?.trim() ?? "";
  return ["unknown place", "near saved places", "visit at an unknown place", "visit near saved places"]
    .includes(title.replace(/\s+/g, " ").toLowerCase()) ? "" : title;
}

const SAVE_PLACE_SIZE_LABELS = { small: "Small", medium: "Medium", large: "Large" } as const;

/** "Saved Gym · 2 more visits now use it" (design §7). */
export function savedPlaceStatus(name: string, rematchedCount: number) {
  if (rematchedCount <= 0) return `Saved ${name}`;
  return `Saved ${name} · ${rematchedCount} more ${rematchedCount === 1 ? "visit now uses" : "visits now use"} it`;
}

/** The marker for a name the person typed in this editor (PRD D19): only when they changed the field. */
export function typedMarker(description: string, edited: boolean) {
  return edited && description.trim() ? { descriptionTyped: true as const } : {};
}
