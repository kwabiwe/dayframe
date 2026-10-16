"use client";

import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { useState, useTransition } from "react";
import { placeDisplayName, placeRoleLabel, placeSecondaryName } from "@dayframe/shared";
import type { LearnedPlaceRow, PlaceRow } from "@/lib/queries";
import { clientFetch } from "@/lib/client-auth-fetch";
import { PlaceRoleSlots } from "./PlaceRoleSlots";
import { Button, ModalDialog } from "./ui/Primitives";

export function PlacesManager({
  learnedPlaces,
  places
}: {
  learnedPlaces: LearnedPlaceRow[];
  places: PlaceRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedLearnedPlace, setSelectedLearnedPlace] = useState<LearnedPlaceRow | null>(null);
  const [deletingPlace, setDeletingPlace] = useState<PlaceRow | null>(null);
  // Shown inside the open delete dialog, where focus is (Codex r1 on #449).
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  function refresh(message: string) {
    setStatus(message);
    startTransition(() => router.refresh());
  }

  async function deletePlace(place: PlaceRow) {
    if (busyId) return;
    setBusyId(place.id);
    setDeleteError(null);
    try {
      const response = await clientFetch(`/api/places?id=${encodeURIComponent(place.id)}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        // The server's own sentence (a 409 says why the delete was refused) beats a generic line.
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? "Unable to delete this place.");
      }
      setDeletingPlace(null);
      refresh("Place deleted.");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Unable to delete this place.");
    } finally {
      setBusyId(null);
    }
  }

  async function ignoreLearnedPlace(learnedPlace: LearnedPlaceRow) {
    if (busyId) return;
    setBusyId(learnedPlace.id);
    try {
      const response = await clientFetch("/api/learned-places", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: learnedPlace.id, status: "ignored" })
      });
      if (!response.ok) throw new Error("Unable to ignore this learned place.");
      setSelectedLearnedPlace(null);
      refresh("Learned place ignored.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to ignore this learned place.");
    } finally {
      setBusyId(null);
    }
  }

  async function forgetLearnedPlace(learnedPlace: LearnedPlaceRow) {
    if (busyId) return;
    setBusyId(learnedPlace.id);
    try {
      const response = await clientFetch(
        `/api/learned-places?id=${encodeURIComponent(learnedPlace.id)}`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("Unable to forget this learned place.");
      setSelectedLearnedPlace(null);
      refresh("Learned place forgotten.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to forget this learned place.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="places-manager">
      {status ? <p className="places-manager-status" role="status">{status}</p> : null}

      {/* Adding a place is the first row of this Library tab, as on the other tabs (UIA-316). */}
      <div className="df-card df-tag-new df-place-new">
        <span className="df-tag-new-field">
          <span className="df-srow-ic" aria-hidden="true"><DayframeIcon glyph="map-pin" size={17}/></span>
          <span className="df-srow-text">
            <b>Add a place</b>
            <small>Search for an address, or use where you are now.</small>
          </span>
        </span>
        <Link className="df-rbtn df-rbtn--sm" href="/places/new">Add place</Link>
      </div>

      <PlaceRoleSlots places={places} onChanged={refresh} />

      <section className="places-list-section">
        <header>
          <div>
            <h2>Your places</h2>
            <p>Saved locations Dayframe can recognise.</p>
          </div>
          <span>{places.length}</span>
        </header>
        <div className="places-list">
          {places.map((place) => (
            <article className="place-list-row" id={`place-${place.id}`} key={place.id}>
              <span className="place-list-icon"><DayframeIcon glyph="map-pin" size={19}/></span>
              <div className="place-list-copy">
                <h3>{placeDisplayName(place)}</h3>
                {placeSecondaryName(place) ? <p>{placeSecondaryName(place)}</p> : null}
                <p>
                  {place.radiusMeters}m radius
                  {" · "}
                  {place.loggingEnabled === false ? "Visit suggestions off" : "Suggest visits"}
                </p>
                {place.loggingEnabled !== false &&
                (place.defaultCategoryName || place.defaultActivityDescription) ? (
                  <p>
                    {[place.defaultCategoryName, place.defaultActivityDescription]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
              </div>
              <div className="place-list-actions">
                <Link
                  aria-label={`Edit ${placeDisplayName(place)}`}
                  className="df-rbtn df-rbtn--sm df-rbtn--ghost"
                  href={`/places/${encodeURIComponent(place.id)}/edit`}
                >
                  Edit
                </Link>
                <button
                  aria-label={`Delete ${placeDisplayName(place)}`}
                  className="df-icon-action df-icon-action--44"
                  onClick={() => {
                    setDeleteError(null);
                    setDeletingPlace(place);
                  }}
                  type="button"
                >
                  <DayframeIcon glyph="trash-2" size={16}/>
                </button>
              </div>
            </article>
          ))}
          {places.length === 0 ? (
            <div className="places-empty-state">
              <DayframeIcon glyph="map-pin" size={22}/>
              <strong>No saved places yet</strong>
              <span>Search for a place to add your first one.</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="places-list-section">
        <header>
          <div>
            <h2>Learned places</h2>
            <p>Repeated locations ready for you to review.</p>
          </div>
          <span>{learnedPlaces.length}</span>
        </header>
        <div className="places-list">
          {learnedPlaces.map((learnedPlace) => (
            <article className="place-list-row" key={learnedPlace.id}>
              <span className="place-list-icon"><DayframeIcon glyph="map-pin" size={19}/></span>
              <div className="place-list-copy">
                <h3>{learnedPlace.poiName || learnedPlace.name}</h3>
                <p>{learnedPlace.formattedAddress || learnedEvidenceSummary(learnedPlace)}</p>
                {learnedPlace.formattedAddress ? (
                  <p>{learnedEvidenceSummary(learnedPlace)}</p>
                ) : null}
              </div>
              <div className="place-list-actions">
                <button
                  aria-label={`View details for ${learnedPlace.name}`}
                  className="df-icon-action df-icon-action--44"
                  onClick={() => setSelectedLearnedPlace(learnedPlace)}
                  type="button"
                >
                  <Info aria-hidden="true" size={16} />
                </button>
                <Link
                  className="df-rbtn df-rbtn--sm"
                  href={`/places/new?learnedPlaceId=${encodeURIComponent(learnedPlace.id)}`}
                >
                  Save as place
                </Link>
                <button
                  className="df-rbtn df-rbtn--sm df-rbtn--ghost"
                  disabled={busyId === learnedPlace.id}
                  onClick={() => void ignoreLearnedPlace(learnedPlace)}
                  type="button"
                >
                  Ignore
                </button>
              </div>
            </article>
          ))}
          {learnedPlaces.length === 0 ? (
            <div className="places-empty-state">
              <strong>No learned places to review</strong>
              <span>Repeated eligible visits will appear here.</span>
            </div>
          ) : null}
        </div>
      </section>

      {deletingPlace ? (
        <ModalDialog
          busy={busyId === deletingPlace.id}
          description={deletingPlace.role
            ? `This is your ${placeRoleLabel(deletingPlace.role)}, so that slot will be empty. Existing blocks keep their time data, but this place label will be removed.`
            : "Existing blocks keep their time data, but this place label will be removed."}
          footer={(
            <>
              <Button disabled={busyId === deletingPlace.id} onClick={() => setDeletingPlace(null)}>
                Cancel
              </Button>
              <Button
                disabled={busyId === deletingPlace.id}
                variant="danger"
                onClick={() => void deletePlace(deletingPlace)}
              >
                {busyId === deletingPlace.id ? "Deleting…" : "Delete"}
              </Button>
            </>
          )}
          onClose={() => setDeletingPlace(null)}
          role="alertdialog"
          title={`Delete ${placeDisplayName(deletingPlace)}?`}
        >
          <p className="place-dialog-copy">This cannot be undone from the Places page.</p>
          {deleteError ? <p className="swiss-inline-error" role="alert">{deleteError}</p> : null}
        </ModalDialog>
      ) : null}

      {selectedLearnedPlace ? (
        <ModalDialog
          busy={busyId === selectedLearnedPlace.id}
          description="Review the saved evidence before deciding what to do."
          footer={(
            <>
              <Button
                disabled={busyId === selectedLearnedPlace.id}
                variant="danger"
                onClick={() => void forgetLearnedPlace(selectedLearnedPlace)}
              >
                Forget
              </Button>
              <Button
                disabled={busyId === selectedLearnedPlace.id}
                onClick={() => void ignoreLearnedPlace(selectedLearnedPlace)}
              >
                Ignore
              </Button>
              <Link
                className="ui-button ui-button-primary"
                href={`/places/new?learnedPlaceId=${encodeURIComponent(selectedLearnedPlace.id)}`}
              >
                Save as place
              </Link>
            </>
          )}
          onClose={() => setSelectedLearnedPlace(null)}
          title={selectedLearnedPlace.poiName || selectedLearnedPlace.name}
        >
          <dl className="place-learned-details">
            <div>
              <dt>Address</dt>
              <dd>{selectedLearnedPlace.formattedAddress || "Address not available"}</dd>
            </div>
            <div>
              <dt>Visit evidence</dt>
              <dd>{learnedEvidenceSummary(selectedLearnedPlace)}</dd>
            </div>
            <div>
              <dt>Suggested radius</dt>
              <dd>{selectedLearnedPlace.radiusMeters}m</dd>
            </div>
          </dl>
        </ModalDialog>
      ) : null}

      {isPending ? <span className="sr-only" role="status">Refreshing places…</span> : null}
    </div>
  );
}

function learnedEvidenceSummary(place: LearnedPlaceRow) {
  return `${place.visitCount} visit${place.visitCount === 1 ? "" : "s"} across ${place.distinctDayCount} day${place.distinctDayCount === 1 ? "" : "s"}`;
}
