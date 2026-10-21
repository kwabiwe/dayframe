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
    expect(refresh).toContain("say(successMessage ?? (bootstrapHasPlace ?");
    expect(places).toContain("restoreMonitoringUnresolved = archive.restoreMonitoringUnresolved");
    expect(refresh).toMatch(/if \(options\.onSettled && !options\.onSettled\("applied"\)\) return;\s*pageReads\.applied\(ticket\);\s*dataRef\.current = reconciled;\s*setData\(reconciled\);/);
    // A failure after a newer read started counts as overtaken, and only the newest read's failure is said (Codex r6 on #508).
    expect(refresh).toContain('if (options.onSettled && !options.onSettled(pageReads.isNewest(ticket) ? "failed" : "stale")) return;');
    // Every status line from a change refresh goes through `say`, which only the newest read may use (Codex r7 on #508).
    expect(refresh).toMatch(/const say = \(message: string\) => \{\s*if \(!pageReads\.isNewest\(ticket\)\) return;/);
    expect(refresh.match(/setStatusMessage\(/g)).toHaveLength(1);
    expect(refresh).toContain("const failureMessage = options.failureMessage?.();");
    // Re-checked after every await before any write (Codex r3 on #508).
    expect(refresh).toMatch(/const bootstrap = await fetchBootstrap\(\);\s*\/\/[^\n]*\n\s*if \(!still\(\)/);
    expect(refresh).toMatch(/await monitorList\(reconciled\);\s*if \(!still\(\)\) return;/);
    expect(refresh).toMatch(/await monitorList\(\{ \.\.\.current, places: options\.fallbackPlaces \}\);\s*if \(!still\(\)\) return;/);
    expect(places).toContain("archive.restoreUnresolved(place.id) ? restoredNotRefreshedMessage(place.name)");
  });

  it("brings a restored place whose refresh failed back from the next list, and refreshes its monitoring", () => {
    const load = between("const load = useCallback(", "useEffect(() => {\n    void load();");
    // …and, once the page has monitored any list, every list it shows (latest wins: Codex r6 on #508).
    expect(load).toMatch(/if \(monitor\.engaged\(\) \|\| unmonitoredRestoredIn\(listAccountKey\(bootstrap\), bootstrap\.places\)\.length > 0\) \{\s*void monitorList\(bootstrap\);/);
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

  it("sends every list through the one read gate, and monitoring through the one queue (Codex r5/r6 on #508)", () => {
    // Every read takes a ticket when it starts, and is judged before its list is applied.
    expect(places.match(/= pageReads\.begin\(accountLifetime\(\)\);/g)).toHaveLength(2);
    expect(places.match(/pageReads\.judge\(ticket, accountLifetime\(\)\)/g)).toHaveLength(2);
    // A fetched list is applied only right after the gate records it (and in the same step as the ref).
    expect(places.match(/pageReads\.applied\(ticket\);\s*dataRef\.current = (bootstrap|reconciled);\s*setData\(\1\);/g)).toHaveLength(2);
    expect(places.match(/setData\((bootstrap|reconciled)\)/g)).toHaveLength(2);
    // Every accepted archive or delete drops the reads already out (Codex r6 on #508).
    const deletes = between("const applyDeletedPlaces = useCallback(", "useFocusEffect(");
    expect(deletes).toMatch(/if \(deleted\.length === 0\) return false;\s*pageReads\.changed\(\);/);
    expect(places).not.toMatch(/takeDeletedPlaces\([^)]*\)\s*\.reduce/);
    // Follow-ups only for the list shown: the newest applied, with no change since.
    expect(places).toContain("!pageReads.isCurrent(ticket)) return;");
    expect(places).not.toContain("isLatestApplied");
    // Geofences are refreshed only through the latest-wins queue.
    expect(places.match(/refreshGeofencesForPlaces\(/g)).toHaveLength(1);
    expect(places).toContain("const monitor = useRef(createMonitorQueue<MonitorInput>({");
    // Nothing queued starts outside its lifetime or after the page closes (Codex r7 on #508).
    expect(places).toContain("runnable: (input) => monitorInputCurrent(input),");
    expect(places).toContain("useEffect(() => () => monitor.clear(), [monitor]);");
    // The status line is shown only for the lifetime and account that wrote it (Codex r8 on #508).
    expect(places).toContain("const statusMessage = status && status.owner === statusOwner() ? status.text : null;");
    expect(places.match(/setStatus\(/g)).toHaveLength(1);
    expect(places).not.toContain("changeEpoch");
    expect(places).not.toContain("readSequence");
  });
});
