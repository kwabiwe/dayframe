"use client";

import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  leavingRoleHolder,
  placeRoleLabel,
  placeRoleRequest,
  placeRoleSlots,
  previousRolePlaceName,
  type PlaceRole
} from "@dayframe/shared";
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
import { Button, SelectField, TextField } from "./ui/Primitives";
import { PlaceMapPreview } from "./PlaceMapPreview";
import { PlaceSearchCombobox } from "./PlaceSearchCombobox";

/** The size choices, as on iPhone (UIA-088); any other size stays exact under Advanced. */
const PLACE_RADIUS_CHOICES = [50, 100, 200] as const;

type PlaceEditorMode = "create" | "edit" | "learned";

export function PlaceEditor({
  categories,
  learnedPlace,
  mode,
  place,
  places,
  role = null
}: {
  categories: CategoryRow[];
  learnedPlace?: LearnedPlaceRow | null;
  mode: PlaceEditorMode;
  place?: PlaceRow | null;
  places: PlaceRow[];
  /** Adding a new place straight into the Home or Work slot. */
  role?: PlaceRole | null;
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
  const [autoLog, setAutoLog] = useState(place?.autoLog === true);
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
  const newRole = mode === "edit" ? null : role;
  const roleSlot = newRole ? placeRoleSlots(places).find((slot) => slot.role === newRole) ?? null : null;
  const roleHolder = roleSlot ? leavingRoleHolder(roleSlot, null) : null;
  const [previousPlaceName, setPreviousPlaceName] = useState(newRole && roleHolder ? previousRolePlaceName(newRole) : "");
  const shownRole = newRole ?? place?.role ?? null;
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
    autoLog,
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
          autoStart: false,
          ...(newRole ? {
            role: newRole,
            previousPlaceName: placeRoleRequest({ role: newRole, targetId: null, holder: roleHolder, previousPlaceName }).previousPlaceName
          } : {})
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

  const radiusError = submitAttempted && !validation.ok && validation.field === "radiusMeters" ? validation.message : null;
  const offMenuRadius = PLACE_RADIUS_CHOICES.some((meters) => String(meters) === radiusMeters.trim()) ? null : radiusMeters.trim();

  return (
    <form className="place-editor df-pe" onSubmit={submit}>
      <EditorGroup id="df-pe-where" title="Where" className="place-editor-search-panel">
        <PlaceSearchCombobox
          key={searchVersion}
          getBias={getBias}
          onClear={() => undefined}
          onSelect={selectSuggestion}
        />
        {selectedResult ? (
          <div className="place-selected-result">
            <span className="place-selected-icon"><DayframeIcon glyph="map-pin" size={19}/></span>
            <span className="place-selected-copy">
              <strong>{selectedResult.title}</strong>
              {selectedResult.formattedAddress || selectedResult.subtitle ? (
                <span>{selectedResult.formattedAddress || selectedResult.subtitle}</span>
              ) : null}
            </span>
            <button
              className="df-rbtn df-rbtn--sm df-rbtn--ghost"
              onClick={() => {
                setSelectedResult(null);
                setSearchVersion((value) => value + 1);
              }}
              type="button"
            >
              Change
            </button>
          </div>
        ) : null}
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
        <button
          className="df-rbtn df-rbtn--sm place-current-location"
          disabled={locating}
          onClick={useCurrentLocation}
          type="button"
        >
          {locating ? "Finding…" : "Use current location"}
        </button>
      </EditorGroup>

      <EditorGroup id="df-pe-name" title="Name">
        <TextField
          id="dayframe-place-name"
          label={shownRole ? "Address or name" : "Name in Dayframe"}
          help={shownRole ? `Dayframe shows this place as ${placeRoleLabel(shownRole)}; this name appears under it.` : undefined}
          placeholder={shownRole ? "The street address" : "Home, Gym, Mum's house…"}
          value={name}
          error={submitAttempted && !validation.ok && validation.field === "name"
            ? validation.message
            : null}
          onChange={(event) => {
            nameTouched.current = true;
            setName(event.target.value);
          }}
        />
        {newRole && roleHolder ? (
          <TextField
            id="dayframe-place-previous-role-name"
            label={`Rename the old ${placeRoleLabel(newRole).toLowerCase()}`}
            help="Its past blocks keep this name, so they don't read as an address. Leave it blank to keep the current name."
            maxLength={120}
            value={previousPlaceName}
            onChange={(event) => setPreviousPlaceName(event.target.value)}
          />
        ) : null}
      </EditorGroup>

      <EditorGroup id="df-pe-size" title="Size">
        {/* Native radios: arrow keys move between sizes, Tab enters and leaves the group. */}
        <div aria-label="Place radius" className="df-pe-seg" role="radiogroup">
          {PLACE_RADIUS_CHOICES.map((meters) => (
            <label key={meters}>
              <input
                checked={radiusMeters.trim() === String(meters)}
                name="df-pe-radius"
                onChange={() => setRadiusMeters(String(meters))}
                type="radio"
                value={meters}
              />
              <span>{meters} m</span>
            </label>
          ))}
        </div>
        {/* A place saved with another size keeps it until a size is picked (as on iPhone). */}
        <p className="df-muted df-pe-note">
          {offMenuRadius ? `This place uses ${offMenuRadius} m. Pick a size to change it, or set an exact size under Advanced.` : "How close counts as being here."}
        </p>
        {radiusError ? <p className="df-pe-error" role="alert">{radiusError}</p> : null}
      </EditorGroup>

      <EditorGroup id="df-pe-visits" title="Visits">
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
                setAutoLog(false);
                setDefaultCategoryId("");
                setDefaultActivityDescription("");
              }
            }}
          />
        </label>
        {/* Owner decision 14 Oct 2026: only with Suggest visits on, off by default. The server still
            sends a visit to Review when it is short of trusted, overlaps tracked time or a timer runs. */}
        <label className={`place-suggestion-toggle${loggingEnabled ? "" : " is-disabled"}`}>
          <span>
            <strong>Log automatically</strong>
            <small>Visits here become blocks without a Review card.</small>
            {shownRole === "home" ? (
              <small className="place-auto-log-caution">Home visits can be long and broad; consider leaving this off.</small>
            ) : null}
          </span>
          <input
            aria-label="Log automatically"
            checked={loggingEnabled && autoLog}
            disabled={!loggingEnabled}
            role="switch"
            type="checkbox"
            onChange={(event) => setAutoLog(event.target.checked)}
          />
        </label>
        {loggingEnabled ? (
          <div className="place-suggestion-defaults">
            <SelectField
              id="place-default-category"
              label="Default activity"
              options={[
                { value: "", label: "No default" },
                ...categories.map((category) => ({ value: category.id, label: category.name }))
              ]}
              value={defaultCategoryId}
              onChange={(event) => setDefaultCategoryId(event.target.value)}
            />
            <TextField
              id="place-default-activity"
              label="Default description"
              maxLength={240}
              placeholder="School drop-off/pickup"
              value={defaultActivityDescription}
              onChange={(event) => setDefaultActivityDescription(event.target.value)}
            />
          </div>
        ) : null}
      </EditorGroup>

      <EditorGroup id="df-pe-advanced" title="Advanced">
        <div className="place-radius-field">
          <label htmlFor="place-radius">Exact size</label>
          <span>
            <input
              id="place-radius"
              aria-describedby={radiusError ? "place-radius-error" : undefined}
              aria-invalid={radiusError ? true : undefined}
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
          {radiusError ? <small id="place-radius-error">{radiusError}</small> : null}
        </div>
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
      </EditorGroup>

      {status ? (
        <p
          className={status.startsWith("Unable") ? "place-editor-status is-error" : "place-editor-status"}
          role="status"
        >
          {status}
        </p>
      ) : null}

      <div className="place-editor-actions">
        <Link className="df-rbtn df-rbtn--ghost" href="/places">Cancel</Link>
        <Button disabled={saving} type="submit" variant="primary">
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

/** One titled group of the editor, as iPhone's place editor groups it (7b). */
function EditorGroup({ children, className, id, title }: { children: React.ReactNode; className?: string; id: string; title: string }) {
  return (
    <section aria-labelledby={`${id}-title`} className={`df-card df-pe-group${className ? ` ${className}` : ""}`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
    </section>
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
