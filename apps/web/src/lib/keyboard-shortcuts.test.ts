import { describe, expect, it } from "vitest";
import { isSearchShortcut, SEARCH_SHORTCUT_LABEL } from "./keyboard-shortcuts";

describe("web keyboard shortcuts", () => {
  it("advertises a platform-neutral search shortcut", () => {
    expect(SEARCH_SHORTCUT_LABEL).toBe("Ctrl/⌘ K");
  });

  it("opens search for either Command-K or Control-K", () => {
    expect(isSearchShortcut({ key: "k", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isSearchShortcut({ key: "K", metaKey: false, ctrlKey: true })).toBe(true);
    expect(isSearchShortcut({ key: "k", metaKey: false, ctrlKey: false })).toBe(false);
    expect(isSearchShortcut({ key: "j", metaKey: true, ctrlKey: false })).toBe(false);
  });
});
