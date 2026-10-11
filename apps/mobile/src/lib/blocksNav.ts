/**
 * Back labels for the Blocks navigation bar (UIA-001): the button names the screen it returns to.
 * Screens reached from more than one place receive a `from` route param from the pushing screen.
 */
export type BlocksNavOrigin = "today" | "review" | "settings";

export function blocksNavOrigin(value: string | string[] | undefined): BlocksNavOrigin | null {
  const origin = Array.isArray(value) ? value[0] : value;
  return origin === "today" || origin === "review" || origin === "settings" ? origin : null;
}

const ORIGIN_LABEL: Record<BlocksNavOrigin, string> = {
  review: "Review",
  settings: "Settings",
  today: "Today"
};

/** Settings opens from Today's avatar; its sections open from Settings unless a link says otherwise. */
export function settingsBackLabel(section: string, from: BlocksNavOrigin | null) {
  if (from) return ORIGIN_LABEL[from];
  return section === "index" ? "Today" : "Settings";
}

/** Location evidence opens from the Review deck unless Today's Review card sent it. */
export function evidenceBackLabel(from: BlocksNavOrigin | null) {
  return from ? ORIGIN_LABEL[from] : "Review";
}
