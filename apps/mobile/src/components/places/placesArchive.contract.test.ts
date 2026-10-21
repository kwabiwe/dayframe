import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Places › Archived on the page itself (location v3 PR 15b; Codex r1 on #508). The restore logic is
// covered by useArchivedPlaces.render.test.tsx; these guard how the page hands its lists to it.
const places = readFileSync(fileURLToPath(new URL("../../../app/places.tsx", import.meta.url)), "utf8");
const between = (from: string, to: string) => places.slice(places.indexOf(from), places.indexOf(to, places.indexOf(from)));

describe("Places › Archived on the page (Codex r1 on #508)", () => {
  it("settles a restore with the refresh's outcome, in the same render that applies its list", () => {
    const refresh = between("async function refreshAfterPlaceChange(", "const places = data?.places");
    expect(refresh).toMatch(/options\.onSettled\?\.\("stale"\);/);
    expect(refresh).toMatch(/options\.onSettled\?\.\("applied"\);\s*setData\(reconciled\);/);
    expect(refresh).toContain('options.onSettled?.("failed")');
    expect(refresh).toContain("options.failureMessage ??");
    expect(places).toContain("failureMessage: restoredNotRefreshedMessage(place.name)");
  });

  it("brings a restored place whose refresh failed back from the next list, and refreshes its monitoring", () => {
    const load = between("const load = useCallback(", "useEffect(() => {\n    void load();");
    expect(load).toMatch(/if \(takePendingRestored\([\s\S]*?\)\) \{\s*void refreshGeofencesForPlaces\(bootstrap\.places/);
    expect(places).toContain("const pendingRestored = pendingRestoredRows(archive.pendingRestored, places);");
    expect(places).toContain("setTimeout(() => { void load(); }, RESTORE_REFRESH_RETRY_MS)");
    expect(places).toContain("testID={`places-restored-${row.id}`}");
  });

  it("restores only through the hook's owned, gated restore", () => {
    expect(places).toContain("onRestore={(place) => void archive.restore(place)}");
    expect(places).not.toContain("setPlaceArchived");
  });

  it("reflows every group around Archived with the shared layout owner", () => {
    for (const title of ["Home and Work", "Saved places", "Suggested places"]) {
      expect(places).toMatch(new RegExp(`<ReflowBlockGroup[^>]*?reduceMotion=\\{reduceMotion\\}[^>]*?title="${title}"`));
      expect(places).not.toMatch(new RegExp(`<SettingsBlockGroup[^>]*?title="${title}"`));
    }
  });
});
