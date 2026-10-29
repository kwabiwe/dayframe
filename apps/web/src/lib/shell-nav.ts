import { DAYFRAME_APP_ICONS, type DayframeGlyph } from "@dayframe/shared";

export type ShellSectionId = "today" | "calendar" | "reports" | "library";

export type ShellSection = {
  id: ShellSectionId;
  label: string;
  href: string;
  glyph: DayframeGlyph;
  /** The letter that follows G to jump here ("G then T · C · P · L"). */
  letter: string;
  paths: readonly string[];
};

// The four Blocks sections, in sidebar order; G then a letter jumps to them (digits are kept
// for starting pinned activities). Activities, Tags and Places are the three Library tabs
// until the Library page merges them.
export const SHELL_SECTIONS: readonly ShellSection[] = [
  { id: "today", label: "Today", href: "/", glyph: DAYFRAME_APP_ICONS.today, letter: "t", paths: ["/"] },
  { id: "calendar", label: "Calendar", href: "/timeline", glyph: DAYFRAME_APP_ICONS.calendar, letter: "c", paths: ["/timeline"] },
  { id: "reports", label: "Reports", href: "/reports", glyph: DAYFRAME_APP_ICONS.reports, letter: "p", paths: ["/reports"] },
  { id: "library", label: "Library", href: "/categories", glyph: DAYFRAME_APP_ICONS.library, letter: "l", paths: ["/categories", "/tags", "/places"] }
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

/** The section a path belongs to, or null for pages outside the four (Settings). */
export function activeShellSection(pathname: string): ShellSection | null {
  return SHELL_SECTIONS.find((section) => section.paths.some((path) => matchesPath(pathname, path))) ?? null;
}

export function activeLibraryTab(pathname: string) {
  return LIBRARY_TABS.find((tab) => matchesPath(pathname, tab.href)) ?? null;
}

type KeyLike = { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

/** How long a G waits for its letter. */
export const GO_TO_SEQUENCE_MS = 900;

function isBare(event: KeyLike) {
  return !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

/** A bare G starts a go-to sequence. */
export function startsGoToSequence(event: KeyLike) {
  return isBare(event) && event.key.toLowerCase() === "g";
}

/** The page the letter after G opens: a section, or Settings for S; otherwise null. */
export function goToTarget(event: KeyLike): string | null {
  if (!isBare(event)) return null;
  const letter = event.key.toLowerCase();
  if (letter === "s") return "/settings";
  return SHELL_SECTIONS.find((section) => section.letter === letter)?.href ?? null;
}

/** Settings › Help asks the shell to open its Keyboard shortcuts dialog. */
export const OPEN_SHORTCUTS_EVENT = "dayframe:open-shortcuts";
