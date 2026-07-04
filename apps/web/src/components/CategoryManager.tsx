"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DAYFRAME_PALETTE, paletteColorFor, paletteKeyFor } from "@dayframe/shared";
import { Archive, Check, Pin, PinOff, Plus, Save } from "lucide-react";
import type { CategoryRow } from "@/lib/queries";

export function CategoryManager({ categories }: { categories: CategoryRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const pinned = categories.filter((category) => category.isPinned);
  const unpinned = categories.filter((category) => !category.isPinned);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function createCategory(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        color: formData.get("color"),
        isPinned: formData.get("isPinned") === "true"
      })
    });
    refresh();
  }

  async function updateCategory(category: CategoryRow, formData: FormData) {
    await fetch("/api/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: category.id,
        name: formData.get("name"),
        color: formData.get("color"),
        isPinned: category.isPinned
      })
    });
    setEditingId(null);
    refresh();
  }

  async function togglePin(category: CategoryRow) {
    await fetch("/api/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: category.id,
        isPinned: !category.isPinned
      })
    });
    refresh();
  }

  async function archiveCategory(category: CategoryRow) {
    if (!window.confirm(`Archive ${category.name}? Existing time entries will keep their history.`)) return;
    await fetch(`/api/categories?id=${category.id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="industrial-panel overflow-hidden">
        <div className="border-b border-[var(--line)] px-4 py-3">
          <h2 className="text-lg font-semibold">Categories</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Pinned categories appear first in timer and mobile quick-start controls.
          </p>
        </div>
        <CategorySection
          title="Pinned"
          empty="No pinned categories yet."
          categories={pinned}
          editingId={editingId}
          isPending={isPending}
          onArchive={archiveCategory}
          onEdit={setEditingId}
          onTogglePin={togglePin}
          onUpdate={updateCategory}
        />
        <CategorySection
          title="All categories"
          empty="Create your first category to start tracking."
          categories={unpinned}
          editingId={editingId}
          isPending={isPending}
          onArchive={archiveCategory}
          onEdit={setEditingId}
          onTogglePin={togglePin}
          onUpdate={updateCategory}
        />
      </section>

      <form action={createCategory} className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] p-4">
        <div>
          <h2 className="text-base font-semibold">New category</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Use categories for the type of work or activity you want to track.</p>
        </div>
        <label className="block text-sm">
          <span className="industrial-field-label">Name</span>
          <input className="industrial-field focus-ring" name="name" placeholder="Deep work" required />
        </label>
        <PalettePicker name="color" defaultValue="lime" />
        <label className="flex items-center gap-2 text-sm">
          <input name="isPinned" type="checkbox" value="true" defaultChecked />
          Pin for quick start
        </label>
        <button className="industrial-button-primary focus-ring w-full text-sm" type="submit" disabled={isPending}>
          <Plus size={16} />
          Create category
        </button>
      </form>
    </div>
  );
}

function CategorySection({
  title,
  empty,
  categories,
  editingId,
  isPending,
  onArchive,
  onEdit,
  onTogglePin,
  onUpdate
}: {
  title: string;
  empty: string;
  categories: CategoryRow[];
  editingId: string | null;
  isPending: boolean;
  onArchive: (category: CategoryRow) => Promise<void>;
  onEdit: (id: string | null) => void;
  onTogglePin: (category: CategoryRow) => Promise<void>;
  onUpdate: (category: CategoryRow, formData: FormData) => Promise<void>;
}) {
  return (
    <div className="border-b border-[var(--line)] last:border-b-0">
      <div className="bg-[var(--surface-inset)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
        {title}
      </div>
      {categories.length === 0 ? <p className="px-4 py-5 text-sm text-[var(--muted)]">{empty}</p> : null}
      <div className="divide-y divide-[var(--line)]">
        {categories.map((category) =>
          editingId === category.id ? (
            <form
              key={category.id}
              action={(formData) => onUpdate(category, formData)}
              className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(180px,1fr)_minmax(240px,1.4fr)_auto]"
            >
              <label className="text-sm">
                <span className="industrial-field-label">Name</span>
                <input
                  className="industrial-field focus-ring"
                  name="name"
                  defaultValue={category.name}
                  required
                />
              </label>
              <PalettePicker name="color" defaultValue={category.color} />
              <div className="flex items-end gap-2">
                <button className="industrial-button-primary focus-ring text-sm" disabled={isPending}>
                  <Save size={15} />
                  Save
                </button>
                <button
                  type="button"
                  className="industrial-button focus-ring text-sm"
                  onClick={() => onEdit(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div key={category.id} className="motion-row flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="h-8 w-8 shrink-0 rounded-lg border border-[var(--line-strong)]"
                  style={{ backgroundColor: paletteColorFor(category.color, category.name) }}
                />
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold">{category.name}</h3>
                  <p className="text-xs text-[var(--muted)]">{category.isPinned ? "Pinned quick action" : "Available category"}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={[
                    "industrial-button focus-ring text-sm",
                    category.isPinned ? "border-[var(--accent)] bg-[var(--surface-muted)] text-[var(--accent)]" : ""
                  ].join(" ")}
                  onClick={() => onTogglePin(category)}
                  aria-label={category.isPinned ? `Unpin ${category.name}` : `Pin ${category.name}`}
                >
                  {category.isPinned ? <Pin size={15} fill="currentColor" /> : <PinOff size={15} />}
                  {category.isPinned ? "Pinned" : "Pin"}
                </button>
                <button type="button" className="industrial-button focus-ring text-sm" onClick={() => onEdit(category.id)}>
                  <Check size={15} />
                  Edit
                </button>
                <button type="button" className="industrial-button-danger focus-ring text-sm" onClick={() => onArchive(category)}>
                  <Archive size={15} />
                  Archive
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function PalettePicker({ name, defaultValue }: { name: string; defaultValue: string }) {
  const defaultKey = paletteKeyFor(defaultValue);

  return (
    <fieldset className="text-sm">
      <legend className="industrial-field-label">Colour</legend>
      <div className="grid grid-cols-6 gap-2">
        {DAYFRAME_PALETTE.map((color) => (
          <label
            key={color.key}
            aria-label={`Use ${color.label} colour`}
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
              data-color={color.key}
              className="block h-8 rounded-lg border border-[var(--line-strong)] shadow-sm peer-checked:border-[var(--foreground)] peer-checked:outline peer-checked:outline-2 peer-checked:outline-[var(--accent)]"
              style={{ backgroundColor: color.hex }}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
