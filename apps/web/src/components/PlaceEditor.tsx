"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LocateFixed, MapPin } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { CategoryRow, LearnedPlaceRow, PlaceRow } from "@/lib/queries";
import { clientFetch } from "@/lib/client-auth-fetch";
import type { WebPlaceSuggestion } from "@/lib/place-search";
import {
  applyWebPlaceSuggestion,
  DEFAULT_WEB_PLACE_RADIUS_METERS,
  formatWebCoordinate,
  friendlyBrowserLocationError,
  parseWebPlaceCoordinate,
  resolveGrantedBrowserCoordinate,
  selectWebPlaceSearchBias,
  validateWebPlaceForm,
  type WebPlaceCoordinate
} from "@/lib/web-place-editor";
import { Button, Disclosure, SelectField, TextField } from "./ui/Primitives";
import { PlaceMapPreview } from "./PlaceMapPreview";
import { PlaceSearchCombobox } from "./PlaceSearchCombobox";

type PlaceEditorMode = "create" | "edit" | "learned";

export function PlaceEditor({
  categories,
  learnedPlace,
  mode,
  place,
  places
}: {
  categories: CategoryRow[];
  learnedPlace?: LearnedPlaceRow | null;
  mode: PlaceEditorMode;
  place?: PlaceRow | null;
  places: PlaceRow[];
}) {
  const router = useRouter();
  const entity = place ?? learnedPlace ?? null;
  const initialCoordinate = coordinateFromEntity(entity);
  const [name, setName] = useState(entity?.name ?? "");
  const [latitude, setLatitude] = useState(
    initialCoordinate ? formatWebCoordinate(initialCoordinate.latitude) : ""
  );
  const [longitude, setLongitude] = useState(
    initialCoordinate ? formatWebCoordinate(initialCoordinate.longitude) : ""
  );
  const [radiusMeters, setRadiusMeters] = useState(
    String(entity?.radiusMeters ?? DEFAULT_WEB_PLACE_RADIUS_METERS)
  );
  const [loggingEnabled, setLoggingEnabled] = useState(
    place ? place.loggingEnabled !== false : true
  );
  const [defaultCategoryId, setDefaultCategoryId] = useState(place?.defaultCategoryId ?? "");
  const [defaultActivityDescription, setDefaultActivityDescription] = useState(
    place?.defaultActivityDescription ?? ""
  );
  const [selectedResult, setSelectedResult] = useState<WebPlaceSuggestion | null>(
    initialSuggestion(entity, initialCoordinate)
  );
  const [coordinateTouched, setCoordinateTouched] = useState(false);
  const [searchVersion, setSearchVersion] = useState(0);
  const [status, setStatus] = useState<string | null>(
    mode === "learned" ? "Review this learned place before saving it." : null
  );
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const saveInFlight = useRef(false);
  const nameTouched = useRef(mode !== "create");

  const coordinate = parseWebPlaceCoordinate(latitude, longitude);
  const numericRadius = Number(radiusMeters);
  const validation = validateWebPlaceForm({
    name,
    latitude,
    longitude,
    radiusMeters,
    loggingEnabled,
    defaultCategoryId,
    defaultActivityDescription
  });
  const savedPlaceCoordinates = useMemo(
    () => places.map(coordinateFromEntity).filter(
      (value): value is WebPlaceCoordinate => value !== null
    ),
    [places]
  );

  const getBias = useCallback(async () => {
    const browserCoordinate = typeof navigator === "undefined"
      ? null
      : await resolveGrantedBrowserCoordinate({
          permissions: navigator.permissions
            ? {
                query: async () => {
                  const result = await navigator.permissions.query({ name: "geolocation" });
                  return { state: result.state };
                }
              }
            : undefined,
          geolocation: navigator.geolocation
        });
    return selectWebPlaceSearchBias({
      selectedCoordinate: coordinateTouched ? coordinate : null,
      existingCoordinate: initialCoordinate,
      browserCoordinate,
      savedPlaceCoordinates
    });
  }, [coordinate, coordinateTouched, initialCoordinate, savedPlaceCoordinates]);

  function applyCoordinate(next: WebPlaceCoordinate) {
    setLatitude(formatWebCoordinate(next.latitude));
    setLongitude(formatWebCoordinate(next.longitude));
    setCoordinateTouched(true);
  }

  function selectSuggestion(suggestion: WebPlaceSuggestion) {
    const next = applyWebPlaceSuggestion(suggestion, name, nameTouched.current);
    setName(next.name);
    setLatitude(next.latitude);
    setLongitude(next.longitude);
    setSelectedResult(suggestion);
    setCoordinateTouched(true);
    setStatus(`${suggestion.title} selected.`);
  }

  function useCurrentLocation() {
    if (locating) return;
    if (!navigator.geolocation) {
      setStatus(friendlyBrowserLocationError());
      return;
    }
    setLocating(true);
    setStatus("Checking current location…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
        applyCoordinate(next);
        setSelectedResult({
          id: "current-location",
          title: "Current location",
          subtitle: typeof position.coords.accuracy === "number"
            ? `About ${Math.round(position.coords.accuracy)}m accuracy`
            : null,
          formattedAddress: null,
          ...next,
          resultType: "current_location"
        });
        setStatus(
          typeof position.coords.accuracy === "number"
            ? `Current location captured with about ${Math.round(position.coords.accuracy)}m accuracy.`
            : "Current location captured."
        );
        setLocating(false);
      },
      (error) => {
        setStatus(friendlyBrowserLocationError(error.code));
        setLocating(false);
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 10_000 }
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAttempted(true);
    if (!validation.ok || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setStatus(null);
    try {
      const response = await clientFetch("/api/places", {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(mode === "edit" && place ? { id: place.id } : {}),
          ...(mode === "learned" && learnedPlace ? { learnedPlaceId: learnedPlace.id } : {}),
          ...validation.value,
          priority: place?.priority ?? 5,
          autoStart: false
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as {
          error?: string;
          issues?: Array<{ message?: string }>;
        } | null;
        throw new Error(
          payload?.error
          ?? payload?.issues?.[0]?.message
          ?? "Unable to save this place."
        );
      }
      router.push("/places");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save this place.");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  const coordinateError = submitAttempted && !validation.ok &&
    (validation.field === "latitude" || validation.field === "longitude")
    ? validation.message
    : null;

  return (
    <form className="place-editor" onSubmit={submit}>
      <section className="place-editor-panel place-editor-search-panel">
        <PlaceSearchCombobox
          key={searchVersion}
          getBias={getBias}
          onClear={() => undefined}
          onSelect={selectSuggestion}
        />
        {selectedResult ? (
          <div className="place-selected-result">
            <span className="place-selected-icon"><MapPin aria-hidden="true" size={19} /></span>
            <span className="place-selected-copy">
              <strong>{selectedResult.title}</strong>
              {selectedResult.formattedAddress || selectedResult.subtitle ? (
                <span>{selectedResult.formattedAddress || selectedResult.subtitle}</span>
              ) : null}
            </span>
            <Button
              compact
              variant="ghost"
              onClick={() => {
                setSelectedResult(null);
                setSearchVersion((value) => value + 1);
              }}
            >
              Change
            </Button>
          </div>
        ) : null}
      </section>

      <section className="place-editor-panel">
        <TextField
          id="dayframe-place-name"
          label="Name in Dayframe"
          placeholder="Home, Gym, Mum's house…"
          value={name}
          error={submitAttempted && !validation.ok && validation.field === "name"
            ? validation.message
            : null}
          onChange={(event) => {
            nameTouched.current = true;
            setName(event.target.value);
          }}
        />

        <PlaceMapPreview
          coordinate={coordinate}
          onChange={(next) => {
            applyCoordinate(next);
            setSelectedResult((current) => current
              ? { ...current, ...next }
              : {
                  id: "map-coordinate",
                  title: name.trim() || "Selected map point",
                  subtitle: null,
                  formattedAddress: null,
                  ...next,
                  resultType: "coordinate"
                });
          }}
          radiusMeters={Number.isFinite(numericRadius) ? numericRadius : 0}
        />

        <div className="place-location-radius-row">
          <Button
            className="place-current-location"
            disabled={locating}
            variant="secondary"
            onClick={useCurrentLocation}
          >
            <LocateFixed aria-hidden="true" size={18} />
            {locating ? "Finding…" : "Current location"}
          </Button>
          <div className="place-radius-field">
            <label htmlFor="place-radius">Radius</label>
            <span>
              <input
                id="place-radius"
                aria-describedby={submitAttempted && !validation.ok && validation.field === "radiusMeters"
                  ? "place-radius-error"
                  : undefined}
                aria-invalid={submitAttempted && !validation.ok && validation.field === "radiusMeters"
                  ? true
                  : undefined}
                className="ui-control"
                inputMode="numeric"
                min={25}
                max={2000}
                type="number"
                value={radiusMeters}
                onChange={(event) => setRadiusMeters(event.target.value)}
              />
              <em>m</em>
            </span>
            {submitAttempted && !validation.ok && validation.field === "radiusMeters" ? (
              <small id="place-radius-error">{validation.message}</small>
            ) : null}
          </div>
        </div>

        <Disclosure summary="Advanced coordinates">
          <div className="place-coordinate-grid">
            <TextField
              id="place-latitude"
              label="Latitude"
              inputMode="decimal"
              value={latitude}
              error={coordinateError}
              onChange={(event) => {
                setLatitude(event.target.value);
                setCoordinateTouched(true);
              }}
            />
            <TextField
              id="place-longitude"
              label="Longitude"
              inputMode="decimal"
              value={longitude}
              onChange={(event) => {
                setLongitude(event.target.value);
                setCoordinateTouched(true);
              }}
            />
          </div>
        </Disclosure>
      </section>

      <section className="place-editor-panel">
        <label className="place-suggestion-toggle">
          <span>
            <strong>Suggest visits here</strong>
            <small>
              {loggingEnabled
                ? "Show detected visits in Review."
                : "Do not suggest visits for this place."}
            </small>
          </span>
          <input
            aria-label="Suggest visits here"
            checked={loggingEnabled}
            role="switch"
            type="checkbox"
            onChange={(event) => {
              setLoggingEnabled(event.target.checked);
              if (!event.target.checked) {
                setDefaultCategoryId("");
                setDefaultActivityDescription("");
              }
            }}
          />
        </label>
        {loggingEnabled ? (
          <div className="place-suggestion-defaults">
            <SelectField
              id="place-default-category"
              label="Default category"
              options={[
                { value: "", label: "No default" },
                ...categories.map((category) => ({ value: category.id, label: category.name }))
              ]}
              value={defaultCategoryId}
              onChange={(event) => setDefaultCategoryId(event.target.value)}
            />
            <TextField
              id="place-default-activity"
              label="Default activity description"
              maxLength={240}
              placeholder="School drop-off/pickup"
              value={defaultActivityDescription}
              onChange={(event) => setDefaultActivityDescription(event.target.value)}
            />
          </div>
        ) : null}
      </section>

      {status ? (
        <p
          className={status.startsWith("Unable") ? "place-editor-status is-error" : "place-editor-status"}
          role="status"
        >
          {status}
        </p>
      ) : null}

      <div className="place-editor-actions">
        <Link className="ui-button ui-button-secondary" href="/places">Cancel</Link>
        <Button disabled={saving} type="submit" variant="primary">
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function coordinateFromEntity(
  entity: PlaceRow | LearnedPlaceRow | null
): WebPlaceCoordinate | null {
  return entity &&
    typeof entity.latitude === "number" &&
    typeof entity.longitude === "number"
    ? { latitude: entity.latitude, longitude: entity.longitude }
    : null;
}

function initialSuggestion(
  entity: PlaceRow | LearnedPlaceRow | null,
  coordinate: WebPlaceCoordinate | null
): WebPlaceSuggestion | null {
  if (!entity || !coordinate) return null;
  const learned = "formattedAddress" in entity ? entity : null;
  return {
    id: entity.id,
    title: learned?.poiName || entity.name,
    subtitle: learned?.formattedAddress ?? null,
    formattedAddress: learned?.formattedAddress ?? null,
    ...coordinate,
    resultType: learned ? "learned_place" : "saved_place"
  };
}
