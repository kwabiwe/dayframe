"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Info, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import type { LearnedPlaceRow, PlaceRow } from "@/lib/queries";
import { clientFetch } from "@/lib/client-auth-fetch";
import { Button, IconButton, ModalDialog } from "./ui/Primitives";

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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  function refresh(message: string) {
    setStatus(message);
    startTransition(() => router.refresh());
  }

  async function deletePlace(place: PlaceRow) {
    if (busyId) return;
    setBusyId(place.id);
    try {
      const response = await clientFetch(`/api/places?id=${encodeURIComponent(place.id)}`, {
        method: "DELETE"
      });
      if (!response.ok) throw new Error("Unable to delete this place.");
      setDeletingPlace(null);
      refresh("Place deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete this place.");
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
            <article className="place-list-row" key={place.id}>
              <span className="place-list-icon"><MapPin aria-hidden="true" size={19} /></span>
              <div className="place-list-copy">
                <h3>{place.name}</h3>
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
                  aria-label={`Edit ${place.name}`}
                  className="ui-button ui-button-secondary is-compact"
                  href={`/places/${encodeURIComponent(place.id)}/edit`}
                >
                  <Pencil aria-hidden="true" size={16} />
                  Edit
                </Link>
                <IconButton
                  label={`Delete ${place.name}`}
                  variant="danger"
                  onClick={() => setDeletingPlace(place)}
                >
                  <Trash2 aria-hidden="true" size={17} />
                </IconButton>
              </div>
            </article>
          ))}
          {places.length === 0 ? (
            <div className="places-empty-state">
              <MapPin aria-hidden="true" size={22} />
              <strong>No saved places yet</strong>
              <span>Search for a place to add your first one.</span>
              <Link className="ui-button ui-button-primary" href="/places/new">Add place</Link>
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
              <span className="place-list-icon"><MapPin aria-hidden="true" size={19} /></span>
              <div className="place-list-copy">
                <h3>{learnedPlace.poiName || learnedPlace.name}</h3>
                <p>{learnedPlace.formattedAddress || learnedEvidenceSummary(learnedPlace)}</p>
                {learnedPlace.formattedAddress ? (
                  <p>{learnedEvidenceSummary(learnedPlace)}</p>
                ) : null}
              </div>
              <div className="place-list-actions">
                <IconButton
                  label={`View details for ${learnedPlace.name}`}
                  onClick={() => setSelectedLearnedPlace(learnedPlace)}
                >
                  <Info aria-hidden="true" size={17} />
                </IconButton>
                <Link
                  className="ui-button ui-button-primary is-compact"
                  href={`/places/new?learnedPlaceId=${encodeURIComponent(learnedPlace.id)}`}
                >
                  <Plus aria-hidden="true" size={16} />
                  Save as place
                </Link>
                <Button
                  compact
                  disabled={busyId === learnedPlace.id}
                  variant="ghost"
                  onClick={() => void ignoreLearnedPlace(learnedPlace)}
                >
                  Ignore
                </Button>
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
          description="Existing time entries keep their time data, but this place label will be removed."
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
          title={`Delete ${deletingPlace.name}?`}
        >
          <p className="place-dialog-copy">This cannot be undone from the Places page.</p>
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
