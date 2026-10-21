"use client";

import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Info, Search, X } from "lucide-react";
import { useId, useMemo, useRef, useState, useTransition } from "react";
import {
  placeDisplayName,
  placeLastVisitLabel,
  placeListLayout,
  placeMatchesSearch,
  placeRecentVisitsLabel,
  placeRoleLabel,
  placeSecondaryName,
  placeVisitsById,
  type PlaceListSectionKey,
  type PlaceVisitStats
} from "@dayframe/shared";
import type { ArchivedPlaceRow, LearnedPlaceRow, PlaceRow } from "@/lib/queries";
import { clientFetch } from "@/lib/client-auth-fetch";
import { PlaceRoleSlots } from "./PlaceRoleSlots";
import { StoppedTripsSection } from "./StoppedTripsSection";
import { Button, IconButton, ModalDialog } from "./ui/Primitives";

const SECTION_NOTES: Record<PlaceListSectionKey, string> = {
  results: "Saved places whose name matches.",
  frequent: "Most visits in the last 30 days.",
  recent: "By your last visit.",
  all: "Saved locations Dayframe can recognise."
};

export function PlacesManager({
  archivedPlaces = [],
  learnedPlaces,
  now,
  places,
  timeZone = null,
  visits = []
}: {
  /** Archived places (PRD D19 A10): restorable, out of every list and matcher meanwhile. */
  archivedPlaces?: ArchivedPlaceRow[];
  learnedPlaces: LearnedPlaceRow[];
  /** The server's time when the page was read, so "Last visit today" renders the same on both sides. */
  now: string;
  places: PlaceRow[];
  timeZone?: string | null;
  /** The person's visits per place (location v3 PR 16c): last visit and visits in 30 days. */
  visits?: PlaceVisitStats[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedLearnedPlace, setSelectedLearnedPlace] = useState<LearnedPlaceRow | null>(null);
  const [deletingPlace, setDeletingPlace] = useState<PlaceRow | null>(null);
  // Shown inside the open delete dialog, where focus is (Codex r1 on #449).
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const visitsById = useMemo(() => placeVisitsById(visits), [visits]);
  const layout = useMemo(() => placeListLayout(places, visitsById, search), [places, visitsById, search]);
  const searching = layout.searchable && search.trim().length > 0;
  const shownArchived = searching ? archivedPlaces.filter((place) => placeMatchesSearch(place, search)) : archivedPlaces;
  const pageNow = useMemo(() => new Date(now), [now]);

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

  /** Archive (true) or restore (false) a place (location v3 PR 15, PRD D19 A10). */
  async function setArchived(place: { id: string }, archived: boolean) {
    if (busyId) return;
    setBusyId(place.id);
    setDeleteError(null);
    try {
      const response = await clientFetch("/api/places/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: place.id, archived })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? (archived ? "Unable to archive this place." : "Unable to restore this place."));
      }
      if (archived) setDeletingPlace(null);
      refresh(archived ? "Place archived. Past blocks keep its name." : "Place restored.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to change this place.";
      if (archived) setDeleteError(message);
      else setStatus(message);
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

      {layout.searchable ? (
        <div className="places-search" role="search">
          <label className="sr-only" htmlFor={searchId}>Search places</label>
          <div className="ui-compound-control place-search-control">
            <Search aria-hidden="true" size={18} />
            <input
              autoComplete="off"
              className="place-search-input"
              id={searchId}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && search) {
                  event.preventDefault();
                  setSearch("");
                }
              }}
              enterKeyHint="search"
              placeholder="Search places"
              ref={searchRef}
              // A text field, not type="search": the field has its own 44 px clear button, and
              // the browser's own clear button can't be hidden through the CSS pipeline.
              role="searchbox"
              type="text"
              value={search}
            />
            {search ? (
              <IconButton
                className="place-search-clear"
                label="Clear search"
                onClick={() => {
                  setSearch("");
                  searchRef.current?.focus();
                }}
              >
                <X aria-hidden="true" size={17} />
              </IconButton>
            ) : null}
          </div>
        </div>
      ) : null}

      {searching ? (
        <p className="sr-only" role="status">
          {resultCount(layout.sections[0]?.places.length ?? 0, shownArchived.length)}
        </p>
      ) : null}

      {layout.sections.map((section) => (
        <section className="places-list-section" aria-labelledby={`places-${section.key}-title`} key={section.key}>
          <header>
            <div>
              <h2 id={`places-${section.key}-title`}>{section.title}</h2>
              <p>{SECTION_NOTES[section.key]}</p>
            </div>
            <span>{section.places.length}</span>
          </header>
          <div className="places-list">
            {section.places.map((place) => {
              const stats = visitsById.get(place.id);
              const visitLine = [
                section.key === "frequent" ? placeRecentVisitsLabel(stats) : null,
                placeLastVisitLabel(stats?.lastVisitAt, pageNow, timeZone)
              ].filter(Boolean).join(" · ");
              return (
                <article
                  className="place-list-row"
                  // One anchor per place: the All (or Results) row, which always lists it.
                  id={section.key === "all" || section.key === "results" ? `place-${place.id}` : undefined}
                  key={place.id}
                >
                  <span className="place-list-icon"><DayframeIcon glyph="map-pin" size={19}/></span>
                  <div className="place-list-copy">
                    <h3>{placeDisplayName(place)}</h3>
                    {placeSecondaryName(place) ? <p>{placeSecondaryName(place)}</p> : null}
                    {visitLine ? <p className="place-list-visit">{visitLine}</p> : null}
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
              );
            })}
          </div>
        </section>
      ))}

      {places.length === 0 ? (
        <section className="places-list-section">
          <header>
            <div>
              <h2>Your places</h2>
              <p>Saved locations Dayframe can recognise.</p>
            </div>
            <span>0</span>
          </header>
          <div className="places-list">
            <div className="places-empty-state">
              <DayframeIcon glyph="map-pin" size={22}/>
              <strong>No saved places yet</strong>
              <span>Search for a place to add your first one.</span>
            </div>
          </div>
        </section>
      ) : null}

      {searching && !layout.sections.length && !shownArchived.length ? (
        <div className="places-empty-state places-search-empty">
          <strong>No places match “{search.trim()}”</strong>
          <span>Try another name, or clear the search.</span>
        </div>
      ) : null}

      {shownArchived.length ? (
        <section className="places-list-section" aria-labelledby="places-archived-title">
          <header>
            <div>
              <h2 id="places-archived-title">Archived</h2>
              <p>Not matched or suggested. Past blocks keep their names.</p>
            </div>
            <span>{shownArchived.length}</span>
          </header>
          <div className="places-list">
            {shownArchived.map((place) => (
              <article className="place-list-row" key={place.id}>
                <span className="place-list-icon"><DayframeIcon glyph="map-pin" size={19}/></span>
                <div className="place-list-copy">
                  <h3>{place.name}</h3>
                  <p>History kept</p>
                </div>
                <div className="place-list-actions">
                  <button
                    aria-label={`Restore ${place.name}`}
                    className="df-rbtn df-rbtn--sm df-rbtn--ghost"
                    disabled={busyId === place.id}
                    onClick={() => void setArchived(place, false)}
                    type="button"
                  >
                    {busyId === place.id ? "Restoring…" : "Restore"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

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

      <StoppedTripsSection />

      {deletingPlace ? (
        <ModalDialog
          busy={busyId === deletingPlace.id}
          description={deletingPlace.role
            ? `This is your ${placeRoleLabel(deletingPlace.role)}, so that slot will be empty. Existing blocks keep their time data, but this place label will be removed. Archive instead keeps its name on past blocks and stops matching it; you can restore it later.`
            : "Existing blocks keep their time data, but this place label will be removed. Archive instead keeps its name on past blocks and stops matching it; you can restore it later."}
          footer={(
            <>
              <Button variant="ghost" disabled={busyId === deletingPlace.id} onClick={() => setDeletingPlace(null)}>
                Cancel
              </Button>
              <Button
                disabled={busyId === deletingPlace.id}
                variant="secondary"
                onClick={() => void setArchived(deletingPlace, true)}
              >
                Archive instead
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
          size="wide"
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

function resultCount(active: number, archived: number) {
  const total = active + archived;
  if (!total) return "No places match.";
  return `${total} place${total === 1 ? "" : "s"} match${total === 1 ? "es" : ""}${archived ? `, ${archived} archived` : ""}.`;
}

function learnedEvidenceSummary(place: LearnedPlaceRow) {
  return `${place.visitCount} visit${place.visitCount === 1 ? "" : "s"} across ${place.distinctDayCount} day${place.distinctDayCount === 1 ? "" : "s"}`;
}
