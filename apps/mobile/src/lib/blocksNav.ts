/**
 * Back labels for the Blocks navigation bar (UIA-001): the button names the screen it returns to.
 * The label comes from the route below in the navigation stack (`usePreviousScreenLabel`); the
 * `from` route param and the per-screen defaults are the fallback when the stack can't name it.
 */
export type BlocksNavOrigin = "calendar" | "reports" | "settings" | "today";

export function blocksNavOrigin(value: string | string[] | undefined): BlocksNavOrigin | null {
  const origin = Array.isArray(value) ? value[0] : value;
  return origin && Object.prototype.hasOwnProperty.call(ORIGIN_LABEL, origin) ? origin as BlocksNavOrigin : null;
}

const ORIGIN_LABEL: Record<BlocksNavOrigin, string> = {
  calendar: "Calendar",
  reports: "Reports",
  settings: "Settings",
  today: "Today"
};

/** Settings opens from a tab's avatar (which names its tab); its sections open from Settings
 * unless a link says otherwise. */
export function settingsBackLabel(section: string, from: BlocksNavOrigin | null) {
  if (from) return ORIGIN_LABEL[from];
  return section === "index" ? "Today" : "Settings";
}

const SETTINGS_SECTION_TITLE: Record<string, string> = {
  automations: "Location",
  categories: "Activities",
  health: "Apple Health",
  profile: "Account",
  sync: "Sync help"
};

/** The title a Settings page shows for its section (index and unknown sections: "Settings"). */
export function settingsSectionTitle(section: string | undefined) {
  return section && Object.prototype.hasOwnProperty.call(SETTINGS_SECTION_TITLE, section)
    ? SETTINGS_SECTION_TITLE[section]
    : "Settings";
}

const TAB_LABEL: Record<string, string> = { calendar: "Calendar", reports: "Reports", today: "Today" };

/** A navigation-state route, as far as back labels need it. */
export type BlocksNavRoute = {
  key?: string;
  name: string;
  params?: object;
  state?: { index?: number; routes: readonly BlocksNavRoute[] };
};

/**
 * The name of the screen a route shows, for the back button of the screen pushed above it: the
 * tab group names its active tab, Settings its section. Null for routes without a known name.
 */
export function routeBackLabel(route: BlocksNavRoute | undefined): string | null {
  if (!route) return null;
  switch (route.name) {
    case "(tabs)": {
      const tabs = route.state;
      const tab = tabs?.routes[tabs.index ?? 0]?.name;
      return tab && Object.prototype.hasOwnProperty.call(TAB_LABEL, tab) ? TAB_LABEL[tab] : null;
    }
    case "settings": {
      const section = (route.params as { section?: unknown } | undefined)?.section;
      return settingsSectionTitle(typeof section === "string" ? section : undefined);
    }
    case "places":
      return "Saved places";
    default:
      return null;
  }
}

/** A back button that can't name its screen just says "Back" (never a wrong name). */
export const GENERIC_BACK_LABEL = "Back";

/**
 * The label for the route just below `key` in a stack's routes: its name, or "Back" when the
 * screen below can't be named (the place editor, onboarding, anything added later). Null only
 * when nothing is below, so callers fall back to their `from` param or default.
 */
export function previousRouteBackLabel(routes: readonly BlocksNavRoute[] | undefined, key: string) {
  const all = routes ?? [];
  const index = all.findIndex((route) => route.key === key);
  return index > 0 ? routeBackLabel(all[index - 1]) ?? GENERIC_BACK_LABEL : null;
}

/** "Back to Settings", or just "Back" for the generic label. */
export function backActionLabel(label: string) {
  return label === GENERIC_BACK_LABEL ? GENERIC_BACK_LABEL : `Back to ${label}`;
}
