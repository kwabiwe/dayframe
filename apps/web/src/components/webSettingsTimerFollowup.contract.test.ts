import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const timer = source("./PersistentTimerBar.tsx");
const runtime = source("./AppShellRuntime.tsx");
const settings = source("./SettingsForms.tsx");
const themeSettings = source("./ThemeSettings.tsx");
const themeToggle = source("./ThemeToggleButton.tsx");
const shell = source("./AppShell.tsx");
const styles = source("../app/globals.css");
const settingsPage = source("../app/settings/page.tsx");

describe("web Settings and running-timer follow-up", () => {
  it("keeps running start-time submission inside one form owner", () => {
    const editor = timer.slice(
      timer.indexOf('id="persistent-timer-start-editor"'),
      timer.indexOf('className={`df-cmd-go')
    );
    expect(editor).not.toContain("<form");
    expect(editor).toContain('event.key !== "Enter"');
    expect(editor).toContain("event.preventDefault()");
    expect(editor).toContain("event.stopPropagation()");
    expect(editor).toContain("void saveStartTime()");
    // A Blocks button pair (owner, 15 Oct 2026): Cancel ghost, Save coral.
    expect(editor).toContain('className="df-rbtn df-rbtn--ghost"');
    expect(editor).toContain('className="df-rbtn df-rbtn--live" disabled={isTimerBusy} onClick={() => void saveStartTime()}');
    expect(runtime).toContain("applyOptimisticActiveEntryPatch(snapshot, sending, startedAt)");
    expect(runtime).toContain("await refresh({ force: true })");
  });

  it("uses the shared date picker and a typed time, never the native date and time inputs (owner, 15 Oct)", () => {
    const editor = timer.slice(
      timer.indexOf('id="persistent-timer-start-editor"'),
      timer.indexOf('className={`df-cmd-go')
    );
    expect(editor).toContain("<DatePickerPopover");
    expect(editor).toContain("max={dateKey(new Date())}");
    expect(editor).toContain("setStartTimeDraft(maskTimeInput(event.target.value))");
    expect(editor).not.toMatch(/type(=|: )"(date|time)"/);
    expect(timer).not.toContain("function NativePickerControl");
    expect(styles).not.toContain(".swiss-native-picker-control");
    // "Set to last stop time · 15:17" keeps its wording (owner).
    expect(editor).toContain('Set to last stop time · <span className="tabular">{formatTime(lastStoppedAt, clock)}</span>');
  });

  it("uses a compact workspace selector with on-demand rename and create controls", () => {
    expect(settings).toContain('aria-label="Workspace"');
    expect(settings).toContain("<select");
    expect(settings).toContain('workspaceAction === "rename"');
    expect(settings).toContain('workspaceAction === "create"');
    expect(settings).toContain("New workspace");
    expect(styles).toMatch(/\.settings-workspace-detail-form \{[^}]*background: var\(--surface-inset\);/s);
  });

  it("provides one icon-only sidebar theme toggle and neutral selected Appearance text", () => {
    expect(shell).toContain("<ThemeToggleButton />");
    expect(themeToggle).toContain('aria-label={label}');
    expect(themeToggle).toContain("setThemeChoice(nextTheme)");
    expect(themeToggle).not.toContain(">Light<");
    expect(themeToggle).not.toContain(">Dark<");
    expect(themeSettings).toContain("getResolvedThemeChoice");
    // The one segmented control (WUI-019): the chosen item is surfaceMuted with primary text.
    expect(styles).not.toMatch(/\.settings-appearance-row \.ui-segmented-control button\[aria-pressed="true"\]/);
    expect(styles).toMatch(/\.ui-segmented-control button\[aria-pressed="true"\] \{[^}]*background: var\(--surface-muted\);[^}]*color: var\(--text-primary\);/s);
  });

  it("uses flat workspace rows", () => {
    // The Profile & workspace popover's rows (the older swiss-profile-section went in the UI audit's
    // dead-CSS sweep, WUI-038): borderless and unfilled until hovered.
    expect(styles).toMatch(/\.df-profile-pop-rows > button,\n\.df-profile-pop-rows > a,\n\.df-profile-pop-rows > form > button \{[^}]*border: 0;[^}]*background: transparent;/s);
  });

  it("keeps cached Settings data visible while refreshing quietly", () => {
    expect(settingsPage).toContain("useAppShellRuntime()");
    expect(settingsPage).toContain("void refresh()");
    expect(settingsPage).toContain("if (!data) return <SettingsInitialLoading />");
    expect(settingsPage).not.toContain("getBootstrapData");
    expect(settingsPage).not.toContain("resolvePageSession");
  });

  it("locks the Places suggestion switch to a pill track on touch browsers", () => {
    expect(styles).toMatch(/\.place-suggestion-toggle input \{[^}]*min-width: 52px;[^}]*max-width: 52px;[^}]*min-height: 30px;[^}]*max-height: 30px;[^}]*-webkit-appearance: none;/s);
    expect(styles).toMatch(/\.place-suggestion-toggle input::before \{[^}]*width: 24px;[^}]*height: 24px;[^}]*border-radius: 999px;/s);
  });
});
