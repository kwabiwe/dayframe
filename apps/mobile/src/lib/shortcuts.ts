import { Platform, Settings } from "react-native";
import type { MobileBootstrap } from "./api";

const SHORTCUT_CATALOG_KEY = "dayframe.shortcutCatalog.v1";

export function syncShortcutCatalog(data: Pick<MobileBootstrap, "categories" | "workspace"> | null | undefined) {
  if (Platform.OS !== "ios" || !data?.workspace) return;

  const catalog = {
    workspace: {
      id: data.workspace.id,
      name: data.workspace.name
    },
    categories: data.categories
      .map((category) => ({
        id: category.id,
        name: category.name
      }))
      .filter((category) => category.name.trim().length > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
  };

  try {
    Settings.set({ [SHORTCUT_CATALOG_KEY]: JSON.stringify(catalog) });
  } catch {
    // Shortcut options are a convenience cache; timer actions still work without it.
  }
}
