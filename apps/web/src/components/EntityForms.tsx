"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { DAYFRAME_PALETTE, paletteColorFor, paletteKeyFor } from "@dayframe/shared";
import { Plus } from "lucide-react";
import type {
  AutomationRuleRow,
  CategoryRow,
  PlaceRow
} from "@/lib/queries";

type EntityListRow = {
  id: string;
  cells: string[];
};

export function EntityForms({
  categories,
  places,
  automationRules,
  mode
}: {
  categories: CategoryRow[];
  places: PlaceRow[];
  automationRules: AutomationRuleRow[];
  mode: "places" | "automation";
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        {mode === "places" ? (
          <EntityList
            title="Places and geofences"
            rows={places.map((place) => ({
              id: place.id,
              cells: [
                place.name,
                `${place.radiusMeters}m`,
                `Priority ${place.priority}`,
                place.defaultCategoryName ?? "No default category",
                place.autoStart ? "Auto-start" : "Review first"
              ]
            }))}
          />
        ) : null}
        {mode === "automation" ? (
          <EntityList
            title="Automation rules"
            rows={automationRules.map((rule) => ({
              id: rule.id,
              cells: [
                rule.name,
                `${rule.triggerSource} / ${rule.triggerType}`,
                rule.placeName ?? "Any place",
                rule.action,
                rule.categoryName ?? "No category",
                rule.enabled ? "Enabled" : "Disabled"
              ]
            }))}
          />
        ) : null}
      </div>
      <div className="space-y-5">
        {mode === "places" ? (
          <CreatePlaceForm categories={categories} />
        ) : null}
        {mode === "automation" ? (
          <CreateAutomationForm categories={categories} places={places} />
        ) : null}
      </div>
    </div>
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

function CreatePlaceForm({
  categories
}: {
  categories: CategoryRow[];
}) {
  return (
    <EntityForm title="New place" entity="place">
      <TextInput name="name" label="Name" placeholder="Place name" required />
      <div className="grid grid-cols-2 gap-3">
        <NumberInput name="latitude" label="Latitude" step="0.000001" />
        <NumberInput name="longitude" label="Longitude" step="0.000001" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumberInput name="radiusMeters" label="Radius" defaultValue="100" />
        <NumberInput name="priority" label="Priority" defaultValue="5" />
      </div>
      <SelectInput name="categoryId" label="Default category" options={categories} />
      <label className="flex items-center gap-2 text-sm">
        <input name="autoStart" type="checkbox" value="true" />
        Auto-start when rule allows
      </label>
    </EntityForm>
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
    await fetch("/api/entities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity, values })
    });
    startTransition(() => router.refresh());
  }

  return (
    <form action={submit} className="space-y-3 border border-[var(--line)] bg-[var(--surface-strong)] p-4">
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
  placeholder,
  required = false
}: {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="industrial-field-label">{label}</span>
      <input
        className="industrial-field focus-ring"
        name={name}
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
        style={{ backgroundColor: paletteColorFor(value) }}
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
  options
}: {
  name: string;
  label: string;
  options: Array<{ id: string; name: string }>;
}) {
  return (
    <label className="block text-sm">
      <span className="industrial-field-label">{label}</span>
      <select className="industrial-field focus-ring" name={name}>
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
