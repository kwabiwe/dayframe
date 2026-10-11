import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const shell = read("./AppShell.tsx");
const signOut = read("./SignOutControl.tsx");
const styles = read("../app/globals.css");

describe("web shell popover, shortcuts and touch targets (audit UIA-204, UIA-208)", () => {
  it("opens the profile popover under the top-bar avatar between the phone layout and the sidebar", () => {
    expect(styles).toMatch(/@media \(min-width: 761px\) and \(max-width: 860px\) \{\s*dialog\.ui-popover-panel\.bottom-left \{\s*margin: 64px 12px auto auto;/);
  });

  it("draws Profile & workspace in Blocks with 44 px rows, a neutral current workspace and Sign out", () => {
    expect(shell).toContain('<div className="df-profile-pop">');
    // The sidebar's avatar button keeps its own .df-profile class and styles.
    expect(styles.match(/^\.df-profile \{/gm)).toHaveLength(1);
    expect(shell).toContain("aria-current={current || undefined}");
    expect(styles).toMatch(/\.df-profile-pop-rows > button,[\s\S]*?\{[^}]*min-height: 44px;/);
    expect(styles).toMatch(/\.df-profile-pop-rows > button\[aria-current="true"\] \{[^}]*background: var\(--surface-muted\);/);
    expect(signOut).toContain('"Sign out"');
    expect(signOut).not.toContain('"Log out"');
  });

  it("lists shortcuts as what they do, then their keys as caps", () => {
    expect(shell).toContain("<div key={keys}><span>{action}</span><kbd>{keys}</kbd></div>");
    expect(styles).toMatch(/\.df-shortcuts kbd \{/);
  });

  it("shows Today's row actions on touch at 44 px, and the sidebar controls are 44 px", () => {
    // Only where the row has its actions column (above 860 px); phones keep tap-to-edit.
    expect(styles).toMatch(/@media \(hover: none\) and \(min-width: 861px\) \{[\s\S]*?\.df-erow-acts \{\s*opacity: 1;[\s\S]*?\.df-erow-acts \.df-icon-action \{\s*width: 44px;\s*height: 44px;/);
    expect(styles).toMatch(/\.df-side-row \.swiss-theme-toggle \{\s*width: 44px;\s*height: 44px;/);
    expect(styles).toMatch(/\.df-side-search,\s*\.df-side-shortcuts \{[^}]*min-height: 44px;/);
  });
});
