"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { DAYFRAME_PALETTE, paletteColorFor, paletteKeyFor } from "@dayframe/shared";
import { Archive, Plus, Save } from "lucide-react";
import type {
  AutomationRuleRow,
  CategoryRow,
  ClientRow,
  PlaceRow,
  ProjectRow,
  TagRow
} from "@/lib/queries";

type EntityListRow = {
  id: string;
  cells: string[];
};

export function EntityForms({
  clients,
  categories,
  projects,
  tags,
  places,
  automationRules,
  mode
}: {
  clients: ClientRow[];
  categories: CategoryRow[];
  projects: ProjectRow[];
  tags: TagRow[];
  places: PlaceRow[];
  automationRules: AutomationRuleRow[];
  mode: "projects" | "places" | "automation";
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        {mode === "projects" ? (
          <>
            <CategorySettings categories={categories} />
            <CompatibilityDetails clients={clients} projects={projects} tags={tags} />
          </>
        ) : null}
        {mode === "places" ? (
          <EntityList
            title="Places and geofences"
            rows={places.map((place) => ({
              id: place.id,
              cells: [
                place.name,
                `${place.radiusMeters}m`,
                `Priority ${place.priority}`,
                place.defaultCategoryName ?? place.defaultProjectName ?? "No default category",
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
        {mode === "projects" ? (
          <>
            <CreateCategoryForm />
          </>
        ) : null}
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

function CategorySettings({ categories }: { categories: CategoryRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function updateCategory(id: string, formData: FormData) {
    const values = Object.fromEntries(formData.entries());
    await fetch(`/api/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.name,
        color: values.color,
        isPinned: values.isPinned === "true"
      })
    });
    startTransition(() => router.refresh());
  }

  async function archiveCategory(id: string, name: string) {
    if (!window.confirm(`Archive ${name}? Existing entries keep their category history.`)) return;
    await fetch(`/api/categories/${id}`, { method: "DELETE" });
    startTransition(() => router.refresh());
  }

  return (
    <section className="industrial-panel">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-lg font-semibold">Categories</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Categories are the primary timer, dashboard and report grouping.
        </p>
      </div>
      <div className="divide-y divide-[var(--line)]">
        {categories.map((category) => (
          <form
            key={category.id}
            action={(formData) => updateCategory(category.id, formData)}
            className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[minmax(180px,1fr)_minmax(260px,1.3fr)_auto]"
          >
            <label>
              <span className="industrial-field-label">Name</span>
              <input
                className="industrial-field focus-ring"
                name="name"
                defaultValue={category.name}
                required
              />
            </label>
            <ColorInput name="color" label="Color" defaultValue={category.color} />
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-sm">
                <input name="isPinned" type="checkbox" value="true" defaultChecked={category.isPinned} />
                Pinned
              </label>
              <button
                className="industrial-button-secondary focus-ring min-h-10 text-sm disabled:opacity-50"
                type="submit"
                disabled={isPending}
              >
                <Save size={16} />
                Save
              </button>
              <button
                className="industrial-button-secondary focus-ring min-h-10 text-sm text-[var(--danger)] disabled:opacity-50"
                type="button"
                disabled={isPending}
                onClick={() => archiveCategory(category.id, category.name)}
              >
                <Archive size={16} />
                Archive
              </button>
            </div>
          </form>
        ))}
      </div>
    </section>
  );
}

function CompatibilityDetails({
  clients,
  projects,
  tags
}: {
  clients: ClientRow[];
  projects: ProjectRow[];
  tags: TagRow[];
}) {
  return (
    <details className="industrial-panel">
      <summary className="cursor-pointer border-b border-[var(--line)] px-4 py-3 text-lg font-semibold">
        Compatibility data
      </summary>
      <div className="space-y-4 p-4">
        <p className="text-sm text-[var(--muted)]">
          These records are kept for migration and historical data compatibility. Day-to-day timer UX should use categories.
        </p>
        <EntityList
          title="Tags"
          rows={tags.map((tag) => ({ id: tag.id, cells: [tag.name, tag.color] }))}
        />
        <EntityList
          title="Historical projects"
          rows={projects.map((project) => ({
            id: project.id,
            cells: [
              project.name,
              project.color,
              project.categoryName ?? "No category",
              project.billable ? "Billable" : "Non-billable"
            ]
          }))}
        />
        <EntityList
          title="Historical clients"
          rows={clients.map((client) => ({ id: client.id, cells: [client.name, client.color] }))}
        />
      </div>
    </details>
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

function CreateCategoryForm() {
  return (
    <EntityForm title="New category" entity="category">
      <TextInput name="name" label="Name" placeholder="Category name" required />
      <ColorInput name="color" label="Color" defaultValue="lime" />
      <label className="flex items-center gap-2 text-sm">
        <input name="isPinned" type="checkbox" value="true" />
        Pin as quick action
      </label>
    </EntityForm>
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

function ColorInput({
  name,
  label,
  defaultValue
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  const defaultKey = paletteKeyFor(defaultValue);

  return (
    <fieldset className="text-sm">
      <legend className="industrial-field-label">{label}</legend>
      <div className="grid grid-cols-6 gap-2">
        {DAYFRAME_PALETTE.map((color) => (
          <label
            key={color.key}
            className="rounded-lg focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)]"
            title={color.label}
          >
            <input
              className="peer sr-only"
              name={name}
              type="radio"
              value={color.key}
              defaultChecked={color.key === defaultKey}
            />
            <span
              className="block h-8 rounded-lg border border-[var(--line-strong)] shadow-sm peer-checked:border-[var(--foreground)] peer-checked:outline peer-checked:outline-2 peer-checked:outline-[var(--accent)]"
              style={{ backgroundColor: color.hex }}
            />
          </label>
        ))}
      </div>
    </fieldset>
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
