"use client";

import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DestructiveConfirmationDialog } from "@/components/DestructiveConfirmationDialog";
import { clientFetch } from "@/lib/client-auth-fetch";
import type { TagRow } from "@/lib/queries";

export function TagManager({ tags }: { tags: TagRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TagRow | null>(null);
  // The last tag asked about stays mounted, so the question fades out when it closes (Codex r1 on #469).
  const [shownDelete, setShownDelete] = useState<TagRow | null>(null);
  if (pendingDelete && pendingDelete !== shownDelete) setShownDelete(pendingDelete);
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

  /** True once created; a refused name stays in the field for another try. */
  async function createTag(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return false;
    try {
      await mutate("/api/tags", "POST", name);
      refresh();
      return true;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create this tag.");
      return false;
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
    <div className="df-tags">
      <form
        className="df-card df-tag-new"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          void createTag(new FormData(form)).then((created) => {
            if (created) form.reset();
          });
        }}
      >
        <label className="df-tag-new-field">
          <span className="df-srow-ic" aria-hidden="true"><DayframeIcon glyph="tag" size={17}/></span>
          <span className="sr-only">New tag name</span>
          <input maxLength={48} name="name" placeholder="New tag, like Planning" required />
        </label>
        <button className="df-rbtn df-rbtn--sm" disabled={isPending} type="submit">
          Create tag
        </button>
      </form>
      {error && !pendingDelete ? <p className="df-review-error" role="alert"><span>{error}</span></p> : null}
      <p className="df-faint df-tags-note">Tags add context to blocks; activities stay the main grouping. Names use letters, numbers, spaces, hyphens or underscores.</p>

      {tags.length === 0 ? (
        <p className="df-muted">No tags yet. Type # in the command bar or create one here.</p>
      ) : (
        <ul className="df-card df-simple-list" aria-busy={isPending}>
          {tags.map((tag) => editingId === tag.id ? (
            <li className="df-srow df-srow--edit" key={tag.id}>
              <span className="df-srow-ic" aria-hidden="true"><DayframeIcon glyph="tag" size={17}/></span>
              <form
                className="df-tag-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  void renameTag(tag, new FormData(event.currentTarget));
                }}
              >
                <label className="sr-only" htmlFor={`tag-name-${tag.id}`}>Name</label>
                <input autoFocus defaultValue={tag.name} id={`tag-name-${tag.id}`} maxLength={48} name="name" required />
                <button className="df-rbtn df-rbtn--sm df-rbtn--live" disabled={isPending} type="submit">Save</button>
                <button className="df-rbtn df-rbtn--sm" onClick={() => setEditingId(null)} type="button">Cancel</button>
              </form>
            </li>
          ) : (
            <li className="df-srow df-srow--tag" id={`tag-${tag.id}`} key={tag.id}>
              <span className="df-srow-ic" aria-hidden="true"><DayframeIcon glyph="tag" size={17}/></span>
              <span className="df-srow-text">
                <b>#{tag.name}</b>
                <small>{tag.usageCount} {tag.usageCount === 1 ? "block" : "blocks"}</small>
              </span>
              <span className="df-srow-acts">
                <button aria-label={`Rename ${tag.name}`} className="df-rbtn df-rbtn--sm df-rbtn--ghost" onClick={() => setEditingId(tag.id)} type="button">
                  Rename
                </button>
                <button aria-label={`Delete ${tag.name}`} className="df-icon-action df-icon-action--44" onClick={() => setPendingDelete(tag)} type="button">
                  <DayframeIcon glyph="trash-2" size={16}/>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {isPending ? <p className="df-faint" role="status">Updating tags…</p> : null}

      {shownDelete ? (
        <DestructiveConfirmationDialog
          body={`#${shownDelete.name} will be removed from ${shownDelete.usageCount} ${shownDelete.usageCount === 1 ? "block" : "blocks"}. The blocks stay.`}
          dialogId="delete-tag"
          error={error}
          isBusy={deleting || isPending}
          onCancel={() => {
            setPendingDelete(null);
            setError(null);
          }}
          onConfirm={() => {
            if (pendingDelete) void removeTag(pendingDelete);
          }}
          open={Boolean(pendingDelete)}
          title="Delete tag?"
        />
      ) : null}
    </div>
  );
}
