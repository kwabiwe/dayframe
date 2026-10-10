import { DAYFRAME_APP_ICONS, resolveActivityIcon, type DayframeGlyph } from "@dayframe/shared";
import type { GlobalSearchResult } from "./global-search";
import { SHELL_SECTIONS } from "./shell-nav";
import { toTimelineDateKey } from "./timeline-view";
import type { TimerDraft } from "./timer-runtime";

// The ⌘K palette (prototype `openPalette`): Start an activity, Go to a section, Add a block,
// switch theme, open the shortcuts, and — once two characters are typed — past work from
// /api/search (Start again, entries, places, tags, Review items).

export type PaletteGroup = "Start" | "Go to" | "Add" | "Settings" | "Start again" | "Found";

export type PaletteAction =
  | { kind: "start"; draft: TimerDraft }
  | { kind: "navigate"; href: string }
  | { kind: "add-block" }
  | { kind: "toggle-theme" }
  | { kind: "shortcuts" };

export type PaletteCommand = {
  id: string;
  group: PaletteGroup;
  label: string;
  detail?: string;
  glyph: DayframeGlyph;
  hint?: string;
  block?: { color: string | null; name: string };
  action: PaletteAction;
};

export type PaletteActivity = { id: string; name: string; color: string | null; icon?: string | null; isPinned: boolean };

const GROUP_ORDER: PaletteGroup[] = ["Start", "Go to", "Add", "Settings", "Start again", "Found"];

export function basePaletteCommands({ activities, theme }: {
  activities: readonly PaletteActivity[];
  theme: "light" | "dark";
}): PaletteCommand[] {
  const starts = activities.map((activity) => ({
    id: `start:${activity.id}`,
    group: "Start" as const,
    label: `Start ${activity.name}`,
    detail: activity.isPinned ? "Pinned" : undefined,
    glyph: resolveActivityIcon(activity).glyph,
    block: { color: activity.color, name: activity.name },
    action: { kind: "start" as const, draft: { categoryId: activity.id, description: "", tagNames: [] } }
  }));
  const sections = [
    ...SHELL_SECTIONS.map((section) => ({ id: section.id, label: section.label, href: section.href, glyph: section.glyph, hint: `G ${section.letter.toUpperCase()}` })),
    { id: "settings", label: "Settings", href: "/settings", glyph: DAYFRAME_APP_ICONS.settings, hint: "G S" },
    { id: "tags", label: "Tags", href: "/tags", glyph: DAYFRAME_APP_ICONS.tag, hint: undefined },
    { id: "places", label: "Places", href: "/places", glyph: DAYFRAME_APP_ICONS.places, hint: undefined }
  ].map((section) => ({
    id: `go:${section.id}`,
    group: "Go to" as const,
    label: section.label,
    glyph: section.glyph,
    hint: section.hint,
    action: { kind: "navigate" as const, href: section.href }
  }));
  return [
    ...starts,
    ...sections,
    { id: "add-block", group: "Add", label: "Add a block", detail: "Log time you already spent", glyph: DAYFRAME_APP_ICONS.add, action: { kind: "add-block" } },
    {
      id: "theme",
      group: "Settings",
      label: theme === "dark" ? "Switch to Daylight" : "Switch to Midnight",
      glyph: theme === "dark" ? "sun" : "moon",
      action: { kind: "toggle-theme" }
    },
    { id: "shortcuts", group: "Settings", label: "Keyboard shortcuts", glyph: "zap", hint: "?", action: { kind: "shortcuts" } }
  ];
}

/**
 * With no query: pinned Starts, then Go to, Add and Settings. With a query: every command
 * whose label or detail contains it, in group order, at most `limit`.
 */
export function filterPaletteCommands(commands: readonly PaletteCommand[], query: string, limit = 12): PaletteCommand[] {
  const needle = query.trim().toLocaleLowerCase();
  const matching = needle
    ? commands.filter((command) => `${command.label} ${command.detail ?? ""}`.toLocaleLowerCase().includes(needle))
    : commands.filter((command) => command.group !== "Start" || command.detail === "Pinned");
  return sortByGroup(matching).slice(0, needle ? limit : undefined);
}

export function sortByGroup(commands: readonly PaletteCommand[]) {
  return [...commands].sort((left, right) => GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group));
}

/** Past work from /api/search as palette commands (Start again, or a link to where it lives). */
export function searchResultCommand(result: GlobalSearchResult): PaletteCommand {
  const occurredAt = result.occurredAt ? new Date(result.occurredAt) : null;
  const date = occurredAt && !Number.isNaN(occurredAt.getTime()) ? toTimelineDateKey(occurredAt) : null;
  if (result.kind === "activity") {
    return {
      id: `again:${result.id}`,
      group: "Start again",
      label: result.label,
      detail: result.detail || undefined,
      glyph: DAYFRAME_APP_ICONS.startAgain,
      block: { color: result.categoryColor, name: result.categoryName ?? result.label },
      action: {
        kind: "start",
        draft: { categoryId: result.categoryId ?? "", description: result.description ?? "", tagNames: result.tagNames }
      }
    };
  }
  const href = result.kind === "entry" && result.entryId && date
    ? `/timeline?date=${date}&scope=day&view=list&entry=${result.entryId}`
    : result.kind === "review"
      ? `/review#review-${result.id.slice("review:".length)}`
      : result.kind === "place"
        ? `/places#place-${result.placeId}`
        : result.kind === "tag"
          ? `/tags#tag-${result.id.slice("tag:".length)}`
          : result.kind === "category"
            ? `/categories#category-${result.categoryId}`
            : date && result.entryId
              ? `/timeline?date=${date}&scope=day&view=list&entry=${result.entryId}`
              : "/timeline?view=list";
  const glyphByKind: Record<Exclude<GlobalSearchResult["kind"], "activity">, DayframeGlyph> = {
    entry: DAYFRAME_APP_ICONS.sourceTimer,
    place: DAYFRAME_APP_ICONS.places,
    category: DAYFRAME_APP_ICONS.library,
    tag: DAYFRAME_APP_ICONS.tag,
    review: DAYFRAME_APP_ICONS.review
  };
  const kindLabel: Record<Exclude<GlobalSearchResult["kind"], "activity">, string> = {
    entry: "Entry",
    place: "Place",
    category: "Activity",
    tag: "Tag",
    review: "Review"
  };
  return {
    id: `found:${result.id}`,
    group: "Found",
    label: result.label,
    detail: [kindLabel[result.kind], result.detail || (occurredAt ? occurredAt.toLocaleDateString() : "")].filter(Boolean).join(" · "),
    glyph: glyphByKind[result.kind],
    action: { kind: "navigate", href }
  };
}
