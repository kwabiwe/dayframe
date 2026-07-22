"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DAYFRAME_PALETTE,
  automationRuleInputFromDraft,
  draftAutomationRuleFromText,
  paletteCssColorFor,
  paletteKeyFor,
  type AutomationRuleDraft,
  type AutomationRuleDraftSavePlan
} from "@dayframe/shared";
import { AlertTriangle, CheckCircle2, Copy, MapPin, Pencil, Plus, Save, Trash2, WandSparkles } from "lucide-react";
import type {
  AutomationRuleRow,
  CategoryRow,
  LearnedPlaceRow,
  PlaceRow
} from "@/lib/queries";
import { clientFetch } from "@/lib/client-auth-fetch";

type EntityListRow = {
  id: string;
  cells: string[];
};

export function EntityForms({
  categories,
  learnedPlaces,
  places,
  automationRules,
  mode
}: {
  categories: CategoryRow[];
  learnedPlaces?: LearnedPlaceRow[];
  places: PlaceRow[];
  automationRules: AutomationRuleRow[];
  mode: "places" | "automation";
}) {
  if (mode === "places") {
    return <PlacesManager categories={categories} learnedPlaces={learnedPlaces ?? []} places={places} />;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <EntityList
          title="Automation rules"
          rows={automationRules.map((rule) => ({
            id: rule.id,
            cells: [
              rule.name,
              `${rule.triggerSource} / ${rule.triggerType}`,
              rule.placeName ?? "Any place",
              rule.action,
              rule.categoryName ?? "Uncategorized",
              rule.activityDescription ?? "Default place label",
              rule.enabled ? "Enabled" : "Disabled"
            ]
          }))}
        />
      </div>
      <div className="space-y-5">
        <RuleDraftAssistant categories={categories} places={places} />
        <CreateAutomationForm categories={categories} places={places} />
      </div>
    </div>
  );
}

function PlacesManager({
  categories,
  learnedPlaces,
  places
}: {
  categories: CategoryRow[];
  learnedPlaces: LearnedPlaceRow[];
  places: PlaceRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<LearnedPlaceRow | null>(null);
  const [selectedLearnedPlace, setSelectedLearnedPlace] = useState<LearnedPlaceRow | null>(null);
  const [ignoringId, setIgnoringId] = useState<string | null>(null);
  const [forgettingId, setForgettingId] = useState<string | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function ignoreLearnedPlace(learnedPlace: LearnedPlaceRow) {
    setIgnoringId(learnedPlace.id);
    try {
      await clientFetch("/api/learned-places", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: learnedPlace.id, status: "ignored" })
      });
      if (promoting?.id === learnedPlace.id) setPromoting(null);
      if (selectedLearnedPlace?.id === learnedPlace.id) setSelectedLearnedPlace(null);
      refresh();
    } finally {
      setIgnoringId(null);
    }
  }

  async function forgetLearnedPlace(learnedPlace: LearnedPlaceRow) {
    setForgettingId(learnedPlace.id);
    try {
      await clientFetch(`/api/learned-places?id=${encodeURIComponent(learnedPlace.id)}`, { method: "DELETE" });
      if (promoting?.id === learnedPlace.id) setPromoting(null);
      if (selectedLearnedPlace?.id === learnedPlace.id) setSelectedLearnedPlace(null);
      refresh();
    } finally {
      setForgettingId(null);
    }
  }

  async function updatePlace(place: PlaceRow, formData: FormData, loggingEnabled: boolean) {
    await clientFetch("/api/places", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: place.id,
        name: formString(formData.get("name")),
        latitude: formNullableNumber(formData.get("latitude")),
        longitude: formNullableNumber(formData.get("longitude")),
        radiusMeters: formNumber(formData.get("radiusMeters")),
        priority: formNumber(formData.get("priority")),
        loggingEnabled,
        defaultCategoryId: loggingEnabled ? formOptionalString(formData.get("defaultCategoryId")) : null,
        defaultActivityDescription: loggingEnabled ? formOptionalString(formData.get("defaultActivityDescription")) : null,
        autoStart: false
      })
    });
    setEditingId(null);
    refresh();
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="industrial-panel overflow-hidden">
        <div className="border-b border-[var(--line)] px-4 py-3">
          <h2 className="text-lg font-semibold">Places and geofences</h2>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {places.map((place) =>
            editingId === place.id ? (
              <PlaceEditForm
                key={place.id}
                categories={categories}
                isPending={isPending}
                onCancel={() => setEditingId(null)}
                onUpdate={updatePlace}
                place={place}
              />
            ) : (
              <div
                key={place.id}
                className="motion-row flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold">{place.name}</h3>
                  {place.loggingEnabled === false ? (
                    <p className="mt-1 text-xs font-semibold text-[var(--accent-text)]">Visit logging off</p>
                  ) : (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {place.defaultActivityDescription ?? "No default activity description"}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {place.loggingEnabled === false
                      ? `${place.radiusMeters}m radius · Priority ${place.priority}`
                      : `${place.defaultCategoryName ?? "No default category"} · ${place.radiusMeters}m radius · Priority ${place.priority}`}
                  </p>
                </div>
                <button
                  type="button"
                  className="industrial-button focus-ring w-fit text-sm"
                  onClick={() => setEditingId(place.id)}
                >
                  <Pencil size={15} />
                  Edit
                </button>
              </div>
            )
          )}
          {places.length === 0 ? (
            <p className="px-4 py-5 text-sm text-[var(--muted)]">No places yet.</p>
          ) : null}
        </div>
        <div className="border-t border-[var(--line)] px-4 py-3">
          <h3 className="text-sm font-semibold">Learned places</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">Top candidates from repeated visits.</p>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {learnedPlaces.map((learnedPlace) => (
            <LearnedPlaceCandidate
              key={learnedPlace.id}
              learnedPlace={learnedPlace}
              ignoring={ignoringId === learnedPlace.id}
              selected={selectedLearnedPlace?.id === learnedPlace.id}
              onOpen={() => setSelectedLearnedPlace(learnedPlace)}
              onPromote={() => setPromoting(learnedPlace)}
              onIgnore={() => void ignoreLearnedPlace(learnedPlace)}
            />
          ))}
          {learnedPlaces.length === 0 ? (
            <p className="px-4 py-5 text-sm text-[var(--muted)]">No learned candidates yet.</p>
          ) : null}
        </div>
        {selectedLearnedPlace ? (
          <LearnedPlaceDetail
            forgetting={forgettingId === selectedLearnedPlace.id}
            ignoring={ignoringId === selectedLearnedPlace.id}
            learnedPlace={selectedLearnedPlace}
            onForget={() => void forgetLearnedPlace(selectedLearnedPlace)}
            onIgnore={() => void ignoreLearnedPlace(selectedLearnedPlace)}
            onPromote={() => setPromoting(selectedLearnedPlace)}
          />
        ) : null}
      </section>
      <CreatePlaceForm categories={categories} learnedPlace={promoting} onCreated={() => setPromoting(null)} />
    </div>
  );
}

function PlaceEditForm({
  categories,
  isPending,
  onCancel,
  onUpdate,
  place
}: {
  categories: CategoryRow[];
  isPending: boolean;
  onCancel: () => void;
  onUpdate: (place: PlaceRow, formData: FormData, loggingEnabled: boolean) => Promise<void>;
  place: PlaceRow;
}) {
  const [loggingEnabled, setLoggingEnabled] = useState(place.loggingEnabled !== false);

  return (
    <form
      action={(formData) => onUpdate(place, formData, loggingEnabled)}
      className="grid gap-3 px-4 py-4 lg:grid-cols-2"
    >
      <TextInput name="name" label="Name" defaultValue={place.name} required />
      <NumberInput
        name="latitude"
        label="Latitude"
        defaultValue={formatOptionalNumber(place.latitude)}
        step="0.000001"
      />
      <NumberInput
        name="longitude"
        label="Longitude"
        defaultValue={formatOptionalNumber(place.longitude)}
        step="0.000001"
      />
      <NumberInput name="radiusMeters" label="Radius" defaultValue={String(place.radiusMeters)} />
      <NumberInput name="priority" label="Priority" defaultValue={String(place.priority)} />
      <PlaceLoggingToggle loggingEnabled={loggingEnabled} onChange={setLoggingEnabled} />
      {loggingEnabled ? (
        <>
          <SelectInput
            name="defaultCategoryId"
            label="Default category"
            options={categories}
            defaultValue={place.defaultCategoryId ?? ""}
          />
          <TextInput
            name="defaultActivityDescription"
            label="Default activity description"
            defaultValue={place.defaultActivityDescription ?? ""}
            placeholder="School drop-off/pickup"
          />
        </>
      ) : null}
      <div className="flex items-end gap-2">
        <button className="industrial-button-primary focus-ring text-sm" disabled={isPending}>
          <Save size={15} />
          Save
        </button>
        <button type="button" className="industrial-button focus-ring text-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EntityList({ title, rows }: { title: string; rows: EntityListRow[] }) {
  return (
    <section className="industrial-panel">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="divide-y divide-[var(--line)]">
        {rows.map((row) => (
          <div key={row.id} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-3">
            <span className="font-medium">{row.cells[0]}</span>
            {row.cells.slice(1).map((cell, cellIndex) => (
              <span key={`${row.id}-${cellIndex}`} className="text-[var(--muted)]">
                {cellIndex === 0 && looksLikeColorValue(cell) ? <ColorCell value={cell} /> : cell}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function LearnedPlaceCandidate({
  learnedPlace,
  ignoring,
  selected,
  onOpen,
  onPromote,
  onIgnore
}: {
  learnedPlace: LearnedPlaceRow;
  ignoring: boolean;
  selected: boolean;
  onOpen: () => void;
  onPromote: () => void;
  onIgnore: () => void;
}) {
  return (
    <div className={["motion-row flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between", selected ? "bg-[var(--surface-muted)]" : ""].join(" ")}>
      <button type="button" className="min-w-0 text-left" onClick={onOpen}>
        <h3 className="truncate text-sm font-semibold">{learnedPlace.name}</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">{formatLearnedPlaceMeta(learnedPlace)}</p>
      </button>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="industrial-button focus-ring text-sm" onClick={onOpen}>
          <MapPin size={15} />
          Details
        </button>
        <button type="button" className="industrial-button-primary focus-ring text-sm" onClick={onPromote}>
          <Plus size={15} />
          Save as place
        </button>
        <button
          type="button"
          className="industrial-button focus-ring text-sm disabled:opacity-50"
          disabled={ignoring}
          onClick={onIgnore}
        >
          Ignore
        </button>
      </div>
    </div>
  );
}

function LearnedPlaceDetail({
  forgetting,
  ignoring,
  learnedPlace,
  onForget,
  onIgnore,
  onPromote
}: {
  forgetting: boolean;
  ignoring: boolean;
  learnedPlace: LearnedPlaceRow;
  onForget: () => void;
  onIgnore: () => void;
  onPromote: () => void;
}) {
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const address = learnedPlaceAddress(learnedPlace);
  const coordinates = learnedPlaceCoordinates(learnedPlace);

  async function copyValue(label: string, value: string | null) {
    if (!value) return;
    await navigator.clipboard?.writeText(value);
    setCopiedLabel(label);
    window.setTimeout(() => setCopiedLabel((current) => current === label ? null : current), 1600);
  }

  return (
    <div className="border-t border-[var(--line)] bg-[var(--surface-muted)] px-4 py-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Learned place detail</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">Review evidence before saving this as a place.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="industrial-button-primary focus-ring text-sm" onClick={onPromote}>
            <Plus size={15} />
            Save
          </button>
          <button
            type="button"
            className="industrial-button focus-ring text-sm disabled:opacity-50"
            disabled={ignoring}
            onClick={onIgnore}
          >
            Ignore
          </button>
          <button
            type="button"
            className="industrial-button-danger focus-ring text-sm disabled:opacity-50"
            disabled={forgetting}
            onClick={onForget}
          >
            <Trash2 size={15} />
            Forget
          </button>
        </div>
      </div>
      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <LearnedPlaceDetailRow label="Resolved name / POI" value={learnedPlace.poiName ?? learnedPlace.name} />
        <LearnedPlaceDetailRow
          copyLabel={copiedLabel}
          label="Address"
          onCopy={() => copyValue("Address", address)}
          value={address ?? "Address not resolved yet"}
        />
        <LearnedPlaceDetailRow
          copyLabel={copiedLabel}
          label="Coordinates"
          onCopy={() => copyValue("Coordinates", coordinates)}
          value={coordinates}
        />
        <LearnedPlaceDetailRow label="Evidence" value={formatLearnedPlaceMeta(learnedPlace)} />
        <LearnedPlaceDetailRow label="Dwell" value={formatLearnedPlaceDwell(learnedPlace)} />
        <LearnedPlaceDetailRow label="Status" value="Place suggestion · Not saved" />
      </dl>
    </div>
  );
}

function LearnedPlaceDetailRow({
  copyLabel,
  label,
  onCopy,
  value
}: {
  copyLabel?: string | null;
  label: string;
  onCopy?: () => void;
  value: string;
}) {
  return (
    <div className="fill-inset-surface px-3 py-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 flex items-start justify-between gap-2 text-sm text-[var(--foreground)]">
        <span className="min-w-0 break-words">{value}</span>
        {onCopy ? (
          <button type="button" className="industrial-button focus-ring shrink-0 text-xs" onClick={onCopy}>
            <Copy size={13} />
            {copyLabel === label ? "Copied" : "Copy"}
          </button>
        ) : null}
      </dd>
    </div>
  );
}

function CreatePlaceForm({
  categories,
  learnedPlace,
  onCreated
}: {
  categories: CategoryRow[];
  learnedPlace?: LearnedPlaceRow | null;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [loggingEnabled, setLoggingEnabled] = useState(true);

  async function submit(formData: FormData) {
    await clientFetch("/api/places", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        learnedPlaceId: learnedPlace?.id,
        name: formString(formData.get("name")),
        latitude: formNullableNumber(formData.get("latitude")),
        longitude: formNullableNumber(formData.get("longitude")),
        radiusMeters: formNumber(formData.get("radiusMeters")),
        priority: formNumber(formData.get("priority")),
        loggingEnabled,
        defaultCategoryId: loggingEnabled ? formOptionalString(formData.get("categoryId")) : null,
        defaultActivityDescription: loggingEnabled ? formOptionalString(formData.get("defaultActivityDescription")) : null,
        autoStart: false
      })
    });
    setLoggingEnabled(true);
    onCreated?.();
    startTransition(() => router.refresh());
  }

  return (
    <form action={submit} className="fill-group-surface space-y-3 p-4">
      <h2 className="text-base font-semibold">{learnedPlace ? "Save learned place" : "New place"}</h2>
      <TextInput name="name" label="Name" defaultValue={learnedPlace?.name} placeholder="Place name" required />
      <div className="grid grid-cols-2 gap-3">
        <NumberInput
          name="latitude"
          label="Latitude"
          defaultValue={formatOptionalNumber(learnedPlace?.latitude ?? null)}
          step="0.000001"
        />
        <NumberInput
          name="longitude"
          label="Longitude"
          defaultValue={formatOptionalNumber(learnedPlace?.longitude ?? null)}
          step="0.000001"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumberInput name="radiusMeters" label="Radius" defaultValue={String(learnedPlace?.radiusMeters ?? 100)} />
        <NumberInput name="priority" label="Priority" defaultValue="5" />
      </div>
      <PlaceLoggingToggle loggingEnabled={loggingEnabled} onChange={setLoggingEnabled} />
      {loggingEnabled ? (
        <>
          <SelectInput name="categoryId" label="Default category" options={categories} />
          <TextInput
            name="defaultActivityDescription"
            label="Default activity description"
            placeholder="School drop-off/pickup"
          />
        </>
      ) : null}
      <button
        className="industrial-button-primary focus-ring w-full text-sm disabled:opacity-50"
        type="submit"
        disabled={isPending}
      >
        <Plus size={16} />
        Create
      </button>
    </form>
  );
}

function PlaceLoggingToggle({
  loggingEnabled,
  onChange
}: {
  loggingEnabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="fill-toggle-row flex items-start justify-between gap-3 px-3 py-3 text-sm">
      <span className="min-w-0">
        <span className="block font-semibold">Log visits</span>
        <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
          {loggingEnabled
            ? "Detected visits can become review items."
            : "Visits here are kept as location evidence only."}
        </span>
      </span>
      <input
        aria-label="Log visits for this place"
        checked={loggingEnabled}
        className="mt-1 h-5 w-5 accent-[var(--accent)]"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

function CreateAutomationForm({
  categories,
  places
}: {
  categories: CategoryRow[];
  places: PlaceRow[];
}) {
  return (
    <EntityForm title="New automation rule" entity="automation_rule">
      <TextInput name="name" label="Name" placeholder="Enter place -> suggest activity" required />
      <SelectInput
        name="triggerSource"
        label="Source"
        options={[
          { id: "geofence_specific", name: "geofence_specific" },
          { id: "geofence_broad", name: "geofence_broad" },
          { id: "nfc", name: "nfc" },
          { id: "shortcut", name: "shortcut" }
        ]}
      />
      <SelectInput
        name="triggerType"
        label="Event"
        options={[
          { id: "geofence_enter", name: "geofence_enter" },
          { id: "geofence_exit", name: "geofence_exit" },
          { id: "nfc_action", name: "nfc_action" },
          { id: "shortcut_action", name: "shortcut_action" }
        ]}
      />
      <SelectInput name="placeId" label="Place" options={places} />
      <SelectInput
        name="action"
        label="Action"
        options={[
          { id: "suggest_timer", name: "suggest_timer" },
          { id: "start_timer", name: "start_timer" },
          { id: "create_review_item", name: "create_review_item" },
          { id: "stop_timer", name: "stop_timer" },
          { id: "ignore_source", name: "ignore_source" }
        ]}
      />
      <SelectInput name="categoryId" label="Category" options={categories} />
    </EntityForm>
  );
}

function RuleDraftAssistant({
  categories,
  places
}: {
  categories: CategoryRow[];
  places: PlaceRow[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<AutomationRuleDraft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPending, startTransition] = useTransition();

  function draftRule() {
    setSaveError(null);
    setSaveMessage(null);
    setDraft(draftAutomationRuleFromText({ text, categories, places }));
  }

  const savePlan = draft ? automationRuleInputFromDraft({ draft, categories, places }) : null;

  async function saveDraftRule() {
    if (!savePlan?.values || isSaving) return;
    setSaveError(null);
    setSaveMessage(null);
    setIsSaving(true);

    try {
      const response = await clientFetch("/api/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: "automation_rule", values: savePlan.values })
      });

      if (!response.ok) {
        setSaveError("Rule could not be saved. Check the saved place/category and try again.");
        return;
      }

      setSaveMessage("Rule saved. Matching place exits will now create review items.");
      startTransition(() => router.refresh());
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="industrial-panel p-4">
      <div className="mb-3">
        <h2 className="text-base font-semibold">Rule assistant</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Draft evidence checks from a plain-language rule before it is enabled.
        </p>
      </div>
      <label className="block text-sm">
        <span className="industrial-field-label">Rule request</span>
        <textarea
          className="industrial-field focus-ring min-h-28 resize-y"
          value={text}
          placeholder="If I drive to Chelmsford rail station and come back home shortly after, log train station pickup/drop-off."
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <button
        className="industrial-button-primary focus-ring mt-3 w-full text-sm"
        type="button"
        onClick={draftRule}
      >
        <WandSparkles size={16} />
        Draft rule
      </button>
      {draft && savePlan ? (
        <RuleDraftPreview
          draft={draft}
          savePlan={savePlan}
          onSave={saveDraftRule}
          isSaving={isSaving || isPending}
          saveError={saveError}
          saveMessage={saveMessage}
        />
      ) : null}
    </section>
  );
}

function RuleDraftPreview({
  draft,
  savePlan,
  onSave,
  isSaving,
  saveError,
  saveMessage
}: {
  draft: AutomationRuleDraft;
  savePlan: AutomationRuleDraftSavePlan;
  onSave: () => void;
  isSaving: boolean;
  saveError: string | null;
  saveMessage: string | null;
}) {
  return (
    <div className="mt-4 space-y-3 border-t border-[var(--line)] pt-4 text-sm">
      <div>
        <p className="font-semibold">{draft.title}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">{draft.summary}</p>
      </div>
      <div className="grid gap-2 text-xs">
        <p>
          <span className="text-[var(--muted)]">Mode:</span> {formatDraftMode(draft.outcome.mode)}
        </p>
        <p>
          <span className="text-[var(--muted)]">Activity:</span> {draft.outcome.description}
        </p>
        <p>
          <span className="text-[var(--muted)]">Category:</span> {draft.outcome.categoryName ?? "Not set"}
        </p>
      </div>
      <RuleDraftList title="Evidence checks" items={draft.conditions} />
      <RuleDraftList title="Simulation checks" items={draft.simulationChecks} />
      {draft.unsupported.length > 0 ? <RuleDraftList title="Not enabled yet" items={draft.unsupported} /> : null}
      <div className="space-y-2 border-t border-[var(--line)] pt-3">
        <p className="text-xs font-semibold text-[var(--muted)]">Saveable rule</p>
        {savePlan.values ? (
          <div className="grid gap-1 text-xs text-[var(--muted)]">
            <p>
              <span className="text-[var(--muted)]">Place:</span>{" "}
              <span className="text-[var(--foreground)]">{draft.placeName ?? "Not set"}</span>
            </p>
            <p>
              <span className="text-[var(--foreground)]">{savePlan.values.triggerSource}</span> /{" "}
              <span className="text-[var(--foreground)]">{savePlan.values.triggerType}</span>
            </p>
            <p>
              <span className="text-[var(--foreground)]">{savePlan.values.action}</span> ·{" "}
              {savePlan.values.activityDescription ?? "Default place label"}
            </p>
          </div>
        ) : null}
        <RuleDraftList title="Save notes" items={savePlan.notes} />
        {savePlan.blockers.length > 0 ? <RuleDraftList title="Before saving" items={savePlan.blockers} /> : null}
        {saveError ? (
          <p className="flex items-start gap-2 text-xs text-red-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {saveError}
          </p>
        ) : null}
        {saveMessage ? (
          <p className="flex items-start gap-2 text-xs text-emerald-300">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            {saveMessage}
          </p>
        ) : null}
        <button
          className="industrial-button-primary focus-ring w-full text-sm disabled:opacity-50"
          type="button"
          onClick={onSave}
          disabled={!savePlan.values || isSaving}
        >
          <Save size={16} />
          Save reviewed rule
        </button>
      </div>
    </div>
  );
}

function RuleDraftList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-[var(--muted)]">{title}</p>
      <ul className="space-y-1 text-xs text-[var(--muted)]">
        {items.map((item) => (
          <li key={item} className="border-l border-[var(--line)] pl-2">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatDraftMode(mode: AutomationRuleDraft["outcome"]["mode"]) {
  return mode === "auto_log_when_matched" ? "Auto-log when matched" : "Review first";
}

function EntityForm({
  title,
  entity,
  children
}: {
  title: string;
  entity: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function submit(formData: FormData) {
    const values = Object.fromEntries(formData.entries());
    await clientFetch("/api/entities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity, values })
    });
    startTransition(() => router.refresh());
  }

  return (
    <form action={submit} className="fill-group-surface space-y-3 p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
      <button
        className="industrial-button-primary focus-ring w-full text-sm disabled:opacity-50"
        type="submit"
        disabled={isPending}
      >
        <Plus size={16} />
        Create
      </button>
    </form>
  );
}

function TextInput({
  name,
  label,
  defaultValue,
  placeholder,
  required = false
}: {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="industrial-field-label">{label}</span>
      <input
        className="industrial-field focus-ring"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}

function NumberInput({
  name,
  label,
  defaultValue,
  step
}: {
  name: string;
  label: string;
  defaultValue?: string;
  step?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="industrial-field-label">{label}</span>
      <input
        className="industrial-field focus-ring"
        name={name}
        type="number"
        defaultValue={defaultValue}
        step={step}
      />
    </label>
  );
}

function ColorCell({ value }: { value: string }) {
  const key = paletteKeyFor(value);
  const color = DAYFRAME_PALETTE.find((item) => item.key === key);

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="h-3 w-3 rounded-full border border-[var(--line-strong)]"
        style={{ backgroundColor: paletteCssColorFor(value) }}
      />
      {color?.label ?? key}
    </span>
  );
}

function looksLikeColorValue(value: string) {
  return DAYFRAME_PALETTE.some((color) => color.key === value) || /^#[0-9a-f]{6}$/i.test(value);
}

function SelectInput({
  name,
  label,
  options,
  defaultValue = ""
}: {
  name: string;
  label: string;
  options: Array<{ id: string; name: string }>;
  defaultValue?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="industrial-field-label">{label}</span>
      <select className="industrial-field focus-ring" name={name} defaultValue={defaultValue}>
        <option value="">None</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function formString(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function formOptionalString(value: FormDataEntryValue | null) {
  const text = formString(value);
  return text || null;
}

function formNullableNumber(value: FormDataEntryValue | null) {
  const text = formString(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function formNumber(value: FormDataEntryValue | null) {
  const number = formNullableNumber(value);
  return number ?? undefined;
}

function formatLearnedPlaceMeta(learnedPlace: LearnedPlaceRow) {
  const visits = learnedPlace.visitCount === 1 ? "1 visit" : `${learnedPlace.visitCount} visits`;
  const days = learnedPlace.distinctDayCount === 1 ? "1 day" : `${learnedPlace.distinctDayCount} days`;
  const samples = learnedPlace.sampleCount === 1 ? "1 sample" : `${learnedPlace.sampleCount} samples`;
  return `${visits} across ${days} · ${samples} · Last seen ${formatShortDate(learnedPlace.lastSeenAt)}`;
}

function learnedPlaceAddress(learnedPlace: LearnedPlaceRow) {
  if (learnedPlace.formattedAddress) return learnedPlace.formattedAddress;
  const address = learnedPlace.address ?? {};
  const parts = [
    stringRecordValue(address, "name"),
    [stringRecordValue(address, "streetNumber"), stringRecordValue(address, "street")].filter(Boolean).join(" "),
    stringRecordValue(address, "district"),
    stringRecordValue(address, "city"),
    stringRecordValue(address, "postalCode")
  ].filter(Boolean);
  return parts.length ? [...new Set(parts)].join(", ") : null;
}

function learnedPlaceCoordinates(learnedPlace: LearnedPlaceRow) {
  return `${learnedPlace.latitude.toFixed(6)}, ${learnedPlace.longitude.toFixed(6)}`;
}

function formatLearnedPlaceDwell(learnedPlace: LearnedPlaceRow) {
  return `${formatDwellSeconds(learnedPlace.totalDwellSeconds)} total · ${formatDwellSeconds(learnedPlace.longestDwellSeconds)} longest stay`;
}

function formatDwellSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${Math.max(1, minutes)}m`;
}

function stringRecordValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatShortDate(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "recently";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

function formatOptionalNumber(value: number | null) {
  return value == null ? "" : String(value);
}
