"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Save, Tag, Trash2, X } from "lucide-react";
import { DestructiveConfirmationDialog } from "@/components/DestructiveConfirmationDialog";
import { clientFetch } from "@/lib/client-auth-fetch";
import type { TagRow } from "@/lib/queries";

export function TagManager({ tags }: { tags: TagRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TagRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function mutate(url: string, method: "POST" | "PATCH", name: string) {
    setError(null);
    const response = await clientFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? `Unable to save tag: ${response.status}`);
    }
  }

  async function createTag(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    try {
      await mutate("/api/tags", "POST", name);
      refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create this tag.");
    }
  }

  async function renameTag(tag: TagRow, formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    try {
      await mutate(`/api/tags/${encodeURIComponent(tag.id)}`, "PATCH", name);
      setEditingId(null);
      refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to rename this tag.");
    }
  }

  async function removeTag(tag: TagRow) {
    setDeleting(true);
    setError(null);
    try {
      const response = await clientFetch(`/api/tags/${encodeURIComponent(tag.id)}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `Unable to delete tag: ${response.status}`);
      }
      setPendingDelete(null);
      refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to delete this tag.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="industrial-panel overflow-hidden" aria-busy={isPending}>
        <div className="border-b border-[var(--line)] px-4 py-3">
          <h2 className="text-lg font-semibold">Tags</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Optional context for tracked tasks. Categories remain the primary classification.
          </p>
        </div>
        {tags.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Tag className="mx-auto text-[var(--muted)]" size={22} />
            <p className="mt-2 text-sm text-[var(--muted)]">No tags yet. Type # in a task or create one here.</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {tags.map((tag) => editingId === tag.id ? (
              <form
                action={(formData) => renameTag(tag, formData)}
                className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
                key={tag.id}
              >
                <label className="text-sm">
                  <span className="industrial-field-label">Name</span>
                  <input className="industrial-field focus-ring" defaultValue={tag.name} name="name" required />
                </label>
                <div className="flex gap-2">
                  <button className="industrial-button-primary focus-ring text-sm" disabled={isPending}>
                    <Save size={15} /> Save
                  </button>
                  <button className="industrial-button focus-ring text-sm" onClick={() => setEditingId(null)} type="button">
                    <X size={15} /> Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="motion-row flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between" key={tag.id}>
                <div className="flex min-w-0 items-center gap-3">
                  <Tag aria-hidden="true" className="shrink-0 text-[var(--muted)]" size={17} />
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">{tag.name}</h3>
                    <p className="text-xs text-[var(--muted)]">
                      #{tag.normalizedName} · {tag.usageCount} {tag.usageCount === 1 ? "entry" : "entries"}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="industrial-button focus-ring text-sm" onClick={() => setEditingId(tag.id)} type="button">
                    <Pencil size={15} /> Rename
                  </button>
                  <button className="industrial-button-danger focus-ring text-sm" onClick={() => setPendingDelete(tag)} type="button">
                    <Trash2 size={15} /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {isPending ? <p className="px-4 py-3 text-sm text-[var(--muted)]" role="status">Updating tags…</p> : null}
      </section>

      <form action={createTag} className="fill-inset-surface space-y-4 p-4">
        <div>
          <h2 className="text-base font-semibold">New tag</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Names use letters, numbers, spaces, hyphens, or underscores.</p>
        </div>
        <label className="block text-sm">
          <span className="industrial-field-label">Name</span>
          <input className="industrial-field focus-ring" maxLength={48} name="name" placeholder="Planning" required />
        </label>
        {error && !pendingDelete ? <p className="swiss-inline-error" role="alert">{error}</p> : null}
        <button className="industrial-button-primary focus-ring w-full text-sm" disabled={isPending} type="submit">
          <Plus size={16} /> Create tag
        </button>
      </form>

      {pendingDelete ? (
        <DestructiveConfirmationDialog
          body={`“${pendingDelete.name}” will be detached from ${pendingDelete.usageCount} ${pendingDelete.usageCount === 1 ? "entry" : "entries"}. The time entries will not be deleted.`}
          dialogId="delete-tag"
          error={error}
          isBusy={deleting || isPending}
          onCancel={() => {
            setPendingDelete(null);
            setError(null);
          }}
          onConfirm={() => void removeTag(pendingDelete)}
          title="Delete tag?"
        />
      ) : null}
    </div>
  );
}
