"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DAYFRAME_ACTIVITY_ICONS,
  DAYFRAME_PALETTE_PICKER,
  paletteKeyFor,
  resolveActivityIcon,
  type DayframePaletteKey
} from "@dayframe/shared";
import { useAppShellRuntime, useRuntimePageData } from "@/components/AppShellRuntime";
import { BlocksToast } from "@/components/blocks/BlocksToast";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { LibraryHead } from "@/components/library/LibraryHead";
import { ModalDialog } from "@/components/ui/Primitives";
import { useIsHydrated } from "@/components/useHydrationSafeNow";
import { blockStyle } from "@/lib/block-style";
import { clientFetch } from "@/lib/client-auth-fetch";
import {
  QUICK_START_PIN_LIMIT,
  activityNameProblem,
  activityWeeks,
  formatActivityWeek,
  libraryGroups,
  pinLimitReached
} from "@/lib/library-activities";
import type { BootstrapData, CategoryRow } from "@/lib/queries";

const NOTICE_MS = 5_000;
const NOTICE_EXIT_MS = 160;
const BUSY_MESSAGE = "Another activity change is still saving. Try again in a moment.";

type Notice = {
  token: number;
  label: string;
  swatch?: CSSProperties;
  undo?: () => void;
  /** The control that held focus went away (the editor closed): focus moves to Undo. */
  takeFocus?: boolean;
  exiting: boolean;
};

/**
 * Library › Activities (Blocks parity step 14a-1): activity cards by group (your own first, then
 * by icon group) with the activity's block and icon, a pin for quick start (six at most), six
 * weeks of time as a sparkline and Edit; New activity; and Archived with Restore. The editor
 * (name, icon, colour, Archive) is a dialog. Every change goes through the existing
 * /api/categories contract, one at a time, and the shell's data refreshes after it.
 */
export function ActivitiesLibrary({ initialData }: { initialData: BootstrapData }) {
  const data = useRuntimePageData(initialData);
  const { refresh } = useAppShellRuntime();
  const hydrated = useIsHydrated();
  const activities = data.categories;

  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CategoryRow | "new" | null>(null);
  const [archived, setArchived] = useState<CategoryRow[] | null>(null);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const busyRef = useRef(false);
  // Undo pressed while another change saves runs as soon as that change finishes.
  const queuedUndoRef = useRef<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);
  const noticeSequence = useRef(0);

  // Only the newest read of the Archived list applies (an archive and a restore can overlap).
  const archivedRead = useRef(0);
  const loadArchived = useCallback(async () => {
    const read = ++archivedRead.current;
    try {
      const response = await clientFetch("/api/categories?archived=1", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const body = await response.json() as { categories?: CategoryRow[] };
      if (read !== archivedRead.current) return;
      setArchived(body.categories ?? []);
      setArchivedError(null);
    } catch {
      if (read === archivedRead.current) setArchivedError("Couldn’t load archived activities.");
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a read on arrival; its result lands later
    void loadArchived();
  }, [hydrated, loadArchived]);

  // The toast's own lifetime: it leaves after five seconds (160 ms exit), or when replaced.
  useEffect(() => {
    if (!notice || notice.exiting) return;
    const token = notice.token;
    const leave = setTimeout(() => {
      setNotice((current) => (current?.token === token ? { ...current, exiting: true } : current));
    }, NOTICE_MS);
    return () => clearTimeout(leave);
  }, [notice]);
  useEffect(() => {
    if (!notice?.exiting) return;
    const token = notice.token;
    const gone = setTimeout(() => setNotice((current) => (current?.token === token ? null : current)), NOTICE_EXIT_MS);
    return () => clearTimeout(gone);
  }, [notice]);

  const announce = useCallback((label: string, swatch?: CSSProperties, undo?: () => void, takeFocus = false) => {
    setNotice({ token: ++noticeSequence.current, label, swatch, undo, takeFocus, exiting: false });
  }, []);

  // A toast leaving with focus on its Undo hands focus to New activity (or, while that is
  // disabled by a saving change, the Library heading), so it never falls to the page.
  useEffect(() => {
    if (!notice?.exiting) return;
    if (!document.activeElement?.closest(".df-toast-host")) return;
    focusLibraryFallback();
  }, [notice?.exiting]);

  /** One change at a time; the shell (quick starts, pickers) refreshes after each. */
  const run = useCallback(async (change: () => Promise<Response>, fallback: string) => {
    if (busyRef.current) {
      setError(BUSY_MESSAGE);
      return null;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await change();
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? fallback);
        return null;
      }
      await refresh().catch(() => null);
      return response;
    } catch {
      setError(fallback);
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
      const queued = queuedUndoRef.current;
      queuedUndoRef.current = null;
      if (queued) queueMicrotask(queued);
    }
  }, [refresh]);

  const patch = useCallback((body: Record<string, unknown>) => clientFetch("/api/categories", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }), []);

  const togglePin = useCallback(async (activity: CategoryRow) => {
    if (pinLimitReached(activities, activity.id)) {
      setError(`Quick start holds ${QUICK_START_PIN_LIMIT} activities. Unpin one first.`);
      return;
    }
    const pinning = !activity.isPinned;
    const done = await run(() => patch({ id: activity.id, isPinned: pinning }), "Couldn’t change the pin.");
    if (done) announce(pinning ? `${activity.name} pinned to quick start` : `${activity.name} unpinned`, blockStyle(activity.color, activity.name));
  }, [activities, announce, patch, run]);

  const restore = useCallback(async (activity: CategoryRow, repin = false) => {
    // The server restores an activity unpinned, so a re-pin (Undo of archiving a pinned
    // activity) is its own request after the restore, inside the same one-change slot.
    let restored = false;
    const done = await run(async () => {
      const response = await patch({ id: activity.id, isArchived: false });
      if (!response.ok || !repin) return response;
      restored = true;
      return patch({ id: activity.id, isPinned: true });
    }, "Couldn’t restore the activity.");
    if (done || restored) void loadArchived();
    // Restored but not re-pinned (quick start filled meanwhile): the shell still shows it.
    if (restored && !done) void refresh().catch(() => null);
    if (done) announce(`${activity.name} restored`, blockStyle(activity.color, activity.name));
    return Boolean(done);
  }, [announce, loadArchived, patch, refresh, run]);

  const archive = useCallback(async (activity: CategoryRow) => {
    const done = await run(() => clientFetch(`/api/categories?id=${encodeURIComponent(activity.id)}`, { method: "DELETE" }), "Couldn’t archive the activity.");
    if (!done) return false;
    void loadArchived();
    announce(`${activity.name} archived. Its history stays.`, blockStyle(activity.color, activity.name), () => {
      void restore(activity, activity.isPinned);
    }, true);
    return true;
  }, [announce, loadArchived, restore, run]);

  const save = useCallback(async (target: CategoryRow | null, draft: { name: string; color: DayframePaletteKey; icon?: string }): Promise<string | null> => {
    // An icon is sent only when one was picked; otherwise the stored choice (or the name) stands.
    const body = { name: draft.name.trim(), color: draft.color, ...(draft.icon ? { icon: draft.icon } : {}) };
    const done = await run(
      () => target
        ? patch({ id: target.id, ...body })
        : clientFetch("/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      target ? "Couldn’t save the activity." : "Couldn’t create the activity."
    );
    if (!done) return null;
    if (!target) announce(`${body.name} created`, blockStyle(body.color, body.name));
    if (target) return target.id;
    const created = await done.clone().json().catch(() => ({})) as { category?: { id?: string } };
    return created.category?.id ?? "";
  }, [announce, patch, run]);

  const nowMs = useClockMs(hydrated);
  const weeks = useMemo(
    () => (nowMs === null
      ? new Map<string, number[]>()
      : activityWeeks([data.historyEntries, data.weekEntries, data.entries, data.activeEntry ? [data.activeEntry] : []], nowMs)),
    [data.activeEntry, data.entries, data.historyEntries, data.weekEntries, nowMs]
  );
  const groups = useMemo(() => libraryGroups(activities), [activities]);
  const pinnedCount = activities.filter((activity) => activity.isPinned).length;

  return (
    <div className="df-library">
      <LibraryHead current="/categories" />
      {error ? (
        <p className="df-review-error" role="alert">
          <span>{error}</span>
          <button className="df-icon-action" type="button" aria-label="Dismiss" onClick={() => setError(null)}>
            <DayframeIcon glyph="x" size={15} />
          </button>
        </p>
      ) : null}
      <p className="df-faint df-library-pins">{pinnedCount} of {QUICK_START_PIN_LIMIT} pinned to quick start</p>
      {groups.map((group) => (
        <section aria-labelledby={`${group.key}-title`} className="df-lib-section" key={group.key}>
          <h2 className="df-lib-group" id={`${group.key}-title`}>
            {group.title}
            {group.ownGroup ? <span className="df-faint">Activities you created</span> : null}
          </h2>
          <div className="df-lib-grid">
            {group.activities.map((activity) => (
              <ActivityCard
                activity={activity}
                busy={busy}
                key={activity.id}
                onEdit={() => setEditing(activity)}
                onTogglePin={() => void togglePin(activity)}
                weeks={weeks.get(activity.id)}
              />
            ))}
            {group.ownGroup ? (
              <button className="df-lnew" disabled={busy} onClick={() => setEditing("new")} type="button">
                <DayframeIcon glyph="plus" size={26} />
                New activity
                <small>Pick a name, icon and colour</small>
              </button>
            ) : null}
          </div>
        </section>
      ))}

      <section aria-labelledby="df-archived-title" className="df-lib-section">
        <h2 className="df-lib-group" id="df-archived-title">
          Archived
          <span className="df-faint">Hidden from pickers. Their history stays in Reports.</span>
        </h2>
        {archivedError ? <p className="df-muted" role="status">{archivedError}</p> : null}
        {archived === null && !archivedError ? <p className="df-muted">Loading…</p> : null}
        {archived?.length === 0 ? <p className="df-muted">No archived activities.</p> : null}
        {archived?.length ? (
          <ul className="df-card df-simple-list">
            {archived.map((activity) => (
              <li className="df-srow" key={activity.id}>
                <span className="df-srow-ic df-block" style={blockStyle(activity.color, activity.name)}>
                  <DayframeIcon glyph={resolveActivityIcon({ icon: activity.icon ?? null, name: activity.name }).glyph} size={17} />
                </span>
                <span className="df-srow-text">
                  <b>{activity.name}</b>
                  <small>Archived</small>
                </span>
                <button
                  className="df-rbtn df-rbtn--sm"
                  disabled={busy}
                  onClick={async () => {
                    // The Archived row goes away: focus moves to the restored card's Edit.
                    if (await restore(activity)) focusCardEdit(activity.id);
                  }}
                  type="button"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {editing ? (
        <ActivityEditor
          activities={activities}
          busy={busy}
          onArchive={async (activity) => {
            if (await archive(activity)) setEditing(null);
          }}
          onClose={() => setEditing(null)}
          onSave={async (draft) => {
            const savedId = await save(editing === "new" ? null : editing, draft);
            if (savedId === null) return;
            setEditing(null);
            // The card may have moved group (or is new): focus its Edit once the dialog has closed.
            focusCardEdit(savedId);
          }}
          serverError={error}
          target={editing === "new" ? null : editing}
        />
      ) : null}

      {notice ? (
        <BlocksToast
          actionLabel={notice.undo ? "Undo" : undefined}
          autoFocusAction={Boolean(notice.undo && notice.takeFocus)}
          exiting={notice.exiting}
          key={notice.token}
          message={notice.label}
          onAction={notice.undo ? () => {
            const undo = notice.undo;
            setNotice((current) => (current ? { ...current, exiting: true } : current));
            // While another change saves, the Undo waits for it and then runs.
            if (busyRef.current) queuedUndoRef.current = () => undo?.();
            else undo?.();
          } : undefined}
          swatchStyle={notice.swatch}
        />
      ) : null}
    </div>
  );
}

function ActivityCard({
  activity,
  busy,
  onEdit,
  onTogglePin,
  weeks
}: {
  activity: CategoryRow;
  busy: boolean;
  onEdit: () => void;
  onTogglePin: () => void;
  weeks: number[] | undefined;
}) {
  const glyph = resolveActivityIcon({ icon: activity.icon ?? null, name: activity.name }).glyph;
  const series = weeks ?? [0, 0, 0, 0, 0, 0];
  const max = Math.max(...series, 1);
  return (
    <article aria-label={activity.name} className="df-card df-lcard" id={`category-${activity.id}`} style={blockStyle(activity.color, activity.name)}>
      <div className="df-lswatch df-block">
        <DayframeIcon glyph={glyph} size={22} />
        <button
          aria-label={activity.isPinned ? `Unpin ${activity.name} from quick start` : `Pin ${activity.name} to quick start`}
          aria-pressed={activity.isPinned}
          className="df-lpin"
          disabled={busy}
          onClick={onTogglePin}
          type="button"
        >
          <DayframeIcon glyph="pin" size={16} />
        </button>
      </div>
      <div className="df-lmeta">
        <div>
          <h3>{activity.name}</h3>
          <small className="df-tnum">
            {formatActivityWeek(series[series.length - 1])}
            {activity.isPinned ? " · pinned" : ""}
          </small>
        </div>
        <span className="df-spark" aria-hidden="true">
          {series.map((seconds, index) => <i key={index} style={{ height: Math.max(3, (seconds / max) * 30) }} />)}
        </span>
      </div>
      <button aria-label={`Edit ${activity.name}`} className="df-rbtn df-rbtn--sm" disabled={busy} onClick={onEdit} type="button">
        <DayframeIcon glyph="pencil" size={15} />
        Edit
      </button>
    </article>
  );
}

function ActivityEditor({
  activities,
  busy,
  onArchive,
  onClose,
  onSave,
  serverError,
  target
}: {
  activities: readonly CategoryRow[];
  busy: boolean;
  onArchive: (activity: CategoryRow) => Promise<void>;
  onClose: () => void;
  onSave: (draft: { name: string; color: DayframePaletteKey; icon?: string }) => Promise<void>;
  serverError: string | null;
  target: CategoryRow | null;
}) {
  const [name, setName] = useState(target?.name ?? "");
  const [color, setColor] = useState<DayframePaletteKey>(() => paletteKeyFor(target?.color, target?.name ?? `${Date.now()}`));
  // Until an icon is picked, the stored choice stands (none: the name decides, as it does live here).
  const [pickedIcon, setPickedIcon] = useState<string | null>(null);
  const resolved = resolveActivityIcon({ icon: pickedIcon ?? target?.icon ?? null, name });
  const icon = resolved.key ?? "";
  const setIcon = (key: string) => setPickedIcon(key);
  const [problem, setProblem] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const iconGlyph = resolved.glyph;

  const submit = () => {
    const issue = activityNameProblem(activities, name, target?.id ?? null);
    setProblem(issue);
    if (issue) {
      nameRef.current?.focus();
      return;
    }
    void onSave({ name, color, icon: pickedIcon ?? undefined });
  };

  const radioKeys = (keys: readonly string[], current: string, pick: (key: string) => void, group: string) =>
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
      if (!step || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      const index = keys.indexOf(current);
      const next = keys[(index + step + keys.length) % keys.length];
      pick(next);
      event.currentTarget.closest(`[data-radio='${group}']`)?.querySelector<HTMLElement>(`[data-key='${next}']`)?.focus();
    };
  const iconKeys = DAYFRAME_ACTIVITY_ICONS.map((candidate) => candidate.key as string);
  const colorKeys = DAYFRAME_PALETTE_PICKER.map((candidate) => candidate.key as string);

  return (
    <ModalDialog
      busy={busy}
      className="df-ce-dialog"
      footer={(
        <>
          {target ? (
            <button className="df-rbtn df-rbtn--ghost" disabled={busy} onClick={() => void onArchive(target)} type="button">
              Archive
            </button>
          ) : null}
          <span className="df-spacer" />
          <button className="df-rbtn" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="df-rbtn df-rbtn--live" disabled={busy} onClick={submit} type="button">
            {target ? "Save" : "Create"}
          </button>
        </>
      )}
      initialFocusRef={nameRef}
      onClose={onClose}
      title={target ? "Edit activity" : "New activity"}
    >
      <div className="df-ce">
        <div className="df-ce-preview df-block" style={blockStyle(color, name)}>
          <DayframeIcon glyph={iconGlyph} size={22} />
          <b>{name.trim() || "New activity"}</b>
        </div>
        <label className="df-ce-field">
          <span>Name</span>
          <input
            aria-invalid={problem ? true : undefined}
            maxLength={80}
            onChange={(event) => {
              setName(event.target.value);
              setProblem(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Name, like Gardening or Piano"
            ref={nameRef}
            type="text"
            value={name}
          />
        </label>
        {problem || serverError ? <p className="df-ce-problem" role="alert">{problem ?? serverError}</p> : null}
        <div>
          <p className="df-ce-label" id="df-ce-icon-label">Icon</p>
          <div aria-labelledby="df-ce-icon-label" className="df-ce-icons" data-radio="icon" role="radiogroup">
            {DAYFRAME_ACTIVITY_ICONS.map((candidate) => (
              <button
                aria-checked={candidate.key === icon}
                aria-label={candidate.label}
                data-key={candidate.key}
                key={candidate.key}
                onClick={() => setIcon(candidate.key)}
                onKeyDown={radioKeys(iconKeys, icon, setIcon, "icon")}
                role="radio"
                tabIndex={candidate.key === icon || (!icon && candidate.key === iconKeys[0]) ? 0 : -1}
                type="button"
              >
                <DayframeIcon glyph={candidate.glyph} size={18} />
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="df-ce-label" id="df-ce-colour-label">Colour</p>
          <div aria-labelledby="df-ce-colour-label" className="df-ce-swatches" data-radio="colour" role="radiogroup">
            {DAYFRAME_PALETTE_PICKER.map((candidate) => (
              <button
                aria-checked={candidate.key === color}
                aria-label={candidate.label}
                className="df-ce-swatch df-block"
                data-key={candidate.key}
                key={candidate.key}
                onClick={() => setColor(candidate.key)}
                onKeyDown={radioKeys(colorKeys, color, (key) => setColor(key as DayframePaletteKey), "colour")}
                role="radio"
                style={blockStyle(candidate.key)}
                tabIndex={candidate.key === color ? 0 : -1}
                type="button"
              />
            ))}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}

function focusLibraryFallback() {
  const create = document.querySelector<HTMLButtonElement>(".df-lnew");
  if (create && !create.disabled) {
    create.focus();
    return;
  }
  document.querySelector<HTMLElement>(".df-page-head h1")?.focus();
}

/** After the editor closes (its opener may be gone), focus the activity's Edit, else a fallback. */
function focusCardEdit(activityId: string) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const edit = activityId
      ? document.getElementById(`category-${activityId}`)?.querySelector<HTMLButtonElement>('button[aria-label^="Edit "]') ?? null
      : null;
    if (edit && !edit.disabled) edit.focus();
    else focusLibraryFallback();
  }));
}

/** The browser clock after hydration, each minute (sparklines and "last 7 days"). */
function useClockMs(hydrated: boolean) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    const tick = () => setNowMs(Date.now());
    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, [hydrated]);
  return nowMs;
}
