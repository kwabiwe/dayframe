import { DAYFRAME_APP_ICONS, type DayframeGlyph } from "@dayframe/shared";

export type ShellSectionId = "today" | "calendar" | "review" | "reports" | "library";

export type ShellSection = {
  id: ShellSectionId;
  label: string;
  href: string;
  glyph: DayframeGlyph;
  key: string;
  paths: readonly string[];
};

// The five Blocks sections, in sidebar order; keys 1–5 jump to them. Activities, Tags and
// Places are the three Library tabs until the Library page merges them.
export const SHELL_SECTIONS: readonly ShellSection[] = [
  { id: "today", label: "Today", href: "/", glyph: DAYFRAME_APP_ICONS.today, key: "1", paths: ["/"] },
  { id: "calendar", label: "Calendar", href: "/timeline", glyph: DAYFRAME_APP_ICONS.calendar, key: "2", paths: ["/timeline"] },
  { id: "review", label: "Review", href: "/review", glyph: DAYFRAME_APP_ICONS.review, key: "3", paths: ["/review"] },
  { id: "reports", label: "Reports", href: "/reports", glyph: DAYFRAME_APP_ICONS.reports, key: "4", paths: ["/reports"] },
  { id: "library", label: "Library", href: "/categories", glyph: DAYFRAME_APP_ICONS.library, key: "5", paths: ["/categories", "/tags", "/places"] }
];

export const LIBRARY_TABS = [
  { href: "/categories", label: "Activities" },
  { href: "/tags", label: "Tags" },
  { href: "/places", label: "Places" }
] as const;

function matchesPath(pathname: string, path: string) {
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** The section a path belongs to, or null for pages outside the five (Settings). */
export function activeShellSection(pathname: string): ShellSection | null {
  return SHELL_SECTIONS.find((section) => section.paths.some((path) => matchesPath(pathname, path))) ?? null;
}

export function activeLibraryTab(pathname: string) {
  return LIBRARY_TABS.find((tab) => matchesPath(pathname, tab.href)) ?? null;
}

/** The section a bare digit key opens (no modifier keys), or null. */
export function shellSectionForKey(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): ShellSection | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  return SHELL_SECTIONS.find((section) => section.key === event.key) ?? null;
}
