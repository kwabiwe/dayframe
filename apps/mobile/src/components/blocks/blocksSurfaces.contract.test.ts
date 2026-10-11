import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const dashboard = read("../DayframeDashboard.tsx");
const settings = read("../../../app/settings.tsx");
const places = read("../../../app/places.tsx");
const placeEditor = read("../../../app/place-editor.tsx");
const review = read("../../../app/review.tsx");
const entrySheet = read("../ActiveTimerEditSheet.tsx");
const activityEditor = read("../settings/ActivityEditorSheet.tsx");

function between(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  expect(from, start).toBeGreaterThanOrEqual(0);
  return source.slice(from, source.indexOf(end, from));
}

describe("Blocks confirm sheet and toast call sites (UIA-003/004/005)", () => {
  it("routes every destructive confirmation through the Blocks confirm sheet", () => {
    for (const title of [
      '"Discard saved Review change?"',
      '"Discard failed time entry change?"',
      '"Discard rejected timer Stop?"',
      '"Clear unreadable local sync data?"',
      '"Clear unreadable device-wide sync data?"',
      '"Clear failed queued events?"',
      '"Clear recent location history?"',
      '"Log out and remove saved changes?"'
    ]) {
      expect(settings).toContain(`title: ${title}`);
    }
    // The unsynced-data warning keeps its meaning and Log out still runs the same sign-out.
    const signOut = between(settings, "async function signOut()", "async function completeSignOut()");
    expect(signOut).toContain("confirmSheet.confirm({");
    expect(signOut).toContain("${reviewWarning}Unsynchronised Location evidence will be removed from this iPhone. Synced history stays in your account.");
    expect(signOut).toContain("onConfirm: () => { void completeSignOut(); }");
    expect(settings).toContain("<BlocksConfirmHost controller={confirmSheet}");
    expect(places).toContain('title: "Ignore learned place?"');
    expect(places).toContain('title: "Forget learned place?"');
    expect(places).toContain('tone: "neutral"');
    expect(placeEditor).toContain("onConfirm: () => void removePlace(place)");
    expect(review).toContain('eyebrow: "Review all"');
    expect(review).toContain("onCancel: () => { bulkSkipInFlight.current = false; }");
    expect(review).toContain("if (!shown) bulkSkipInFlight.current = false;");
    expect(entrySheet).toContain('title: "Discard changes?"');
    expect(activityEditor).toContain("title: `Archive ${target.name}?`");
  });

  it("turns quick-start limits and busy notices into toasts", () => {
    expect(settings).toContain("settingsNotice.show(`Quick start holds ${QUICK_START_PIN_LIMIT}. Unpin one first.`");
    expect(settings).toContain("settingsNotice.show(`Quick start is full. ${result.category.name} was created but not pinned.`");
    expect(settings).toContain("settingsNotice.show(ACTIVITY_CHANGE_BUSY_MESSAGE)");
    expect(settings).not.toContain('Alert.alert("Quick start is full"');
    expect(settings).not.toContain('"Location evidence deleted"');
  });

  it("says Switched and Already recording on Today, and never adds a Stop toast", () => {
    const start = between(dashboard, "function startFromToday(", "function showTodayNotice(");
    expect(start).toContain("startMatchesRunning(running, { categoryId, description, tagNames })");
    expect(start).toContain("alreadyRecordingToastMessage(running)");
    expect(start).toContain("switchedToastMessage(nextName, running, Date.now())");
    // The notice follows the accepted start only.
    expect(start.indexOf("if (!accepted) return;")).toBeLessThan(start.indexOf("switchedToastMessage("));
    const stop = between(dashboard, "function stopFromToday()", "function tapPlayOrb()");
    expect(stop).not.toContain("showTodayNotice");
    expect(stop).not.toContain("todayNotice");
    // The delete Undo toast always holds the place.
    expect(dashboard).toContain('if (deletionCoordinator.current?.current()?.phase === "active") {');
    expect(dashboard).toMatch(/pendingDeletion\?\.phase === "active" \? \([\s\S]*?<BlocksToast[\s\S]*?\) : todayNotice\.notice \? \(/);
  });
});
