export const SEARCH_SHORTCUT_LABEL = "Ctrl/⌘ K";

export function isSearchShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
}) {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
}
