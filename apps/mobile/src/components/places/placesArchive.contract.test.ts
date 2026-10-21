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
    // Settled first, and nothing applied or said when it no longer belongs to the account shown (Codex r2 on #508).
    expect(refresh).toMatch(/if \(options\.onSettled && !options\.onSettled\("stale"\)\) return;\s*\/\/[^\n]*\n\s*const staleMessage = options\.successMessage\?\.\(\);/);
    // "restored" only once monitored: an unresolved restore keeps its honest line (Codex r4 on #508).
    expect(refresh).toContain("setStatusMessage(successMessage ?? (bootstrapHasPlace ?");
    expect(places).toContain("restoreMonitoringUnresolved = archive.restoreMonitoringUnresolved");
    expect(refresh).toMatch(/if \(options\.onSettled && !options\.onSettled\("applied"\)\) return;\s*pageReads\.applied\(ticket\);\s*setData\(reconciled\);/);
    expect(refresh).toContain('if (options.onSettled && !options.onSettled("failed")) return;');
    expect(refresh).toContain("const failureMessage = options.failureMessage?.();");
    // Re-checked after every await before any write (Codex r3 on #508).
    expect(refresh).toMatch(/const bootstrap = await fetchBootstrap\(\);\s*\/\/[^\n]*\n\s*if \(!still\(\)/);
    expect(refresh).toMatch(/await monitorList\(reconciled, ticket\);\s*if \(!still\(\)\) return;/);
    expect(refresh).toMatch(/await refreshGeofencesForPlaces\(options\.fallbackPlaces[^\n]*\n\s*if \(!still\(\)\) return;/);
    expect(places).toContain("archive.restoreUnresolved(place.id) ? restoredNotRefreshedMessage(place.name)");
  });

  it("brings a restored place whose refresh failed back from the next list, and refreshes its monitoring", () => {
    const load = between("const load = useCallback(", "useEffect(() => {\n    void load();");
    expect(load).toContain("if (unmonitoredRestoredIn(listAccountKey(bootstrap), bootstrap.places).length > 0) void monitorList(bootstrap, ticket);");
    expect(places).toContain("const pendingRestored = pendingRestoredRows(archive.pendingRestored, places);");
    expect(places).toContain("Math.min(RESTORE_REFRESH_RETRY_MS * 2 ** restoreRetries, RESTORE_REFRESH_RETRY_MAX_MS)");
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

  it("sends every list through the one read gate (Codex r5 on #508)", () => {
    // Every read takes a ticket when it starts, and is judged before its list is applied.
    expect(places.match(/= pageReads\.begin\(accountLifetime\(\)\);/g)).toHaveLength(2);
    expect(places.match(/pageReads\.judge\(ticket, accountLifetime\(\)\)/g)).toHaveLength(2);
    // A fetched list is applied only right after the gate records it.
    expect(places.match(/pageReads\.applied\(ticket\);\s*setData\((bootstrap|reconciled)\);/g)).toHaveLength(2);
    // Monitoring and late follow-ups only for the newest applied list; no other read ordering.
    expect(places).toContain("if (!pageReads.isLatestApplied(ticket)) return;");
    expect(places).not.toContain("changeEpoch");
    expect(places).not.toContain("readSequence");
  });
});

