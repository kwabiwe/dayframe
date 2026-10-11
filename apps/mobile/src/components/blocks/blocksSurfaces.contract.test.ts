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
      '"Discard this change?"',
      '"Discard this block change?"',
      '"Discard this Stop?"',
      '"Clear unreadable changes?"',
      '"Clear unreadable changes on this iPhone?"',
      '"Clear changes that can\'t be sent?"',
      '"Clear recent location history?"',
      '"Sign out?"'
    ]) {
      expect(settings).toContain(`title: ${title}`);
    }
    // The unsynced-data warning keeps its meaning and Log out still runs the same sign-out.
    const signOut = between(settings, "async function signOutChecked()", "async function completeSignOut()");
    expect(signOut).toContain("void confirmForSession({");
    expect(signOut).toContain("${reviewWarning}Location points not yet sent from this iPhone will be removed. Everything already synced stays in your account.");
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

  it("binds every destructive Settings confirmation to the session it was asked in (Codex r1 #1)", () => {
    // Only the session-bound wrapper (and the bound logout recovery below) opens the sheet.
    expect(settings.match(/confirmSheet\.confirm\(/g)).toHaveLength(2);
    expect(between(settings, "async function offerLogoutRecovery()", "async function confirmForSession(")).toContain("confirmSheet.confirm({");
    expect(settings.match(/void confirmForSession\(\{/g)).toHaveLength(8);
    const wrapper = between(settings, "async function confirmForSession(", "\n  }\n");
    expect(wrapper).toContain("authority ??= await captureConfirmAuthority();");
    expect(wrapper).toContain("if (!authority || !(await confirmAuthorityStillCurrent(authority))) {");
    expect(wrapper).toContain("confirmSheet.confirm(bindConfirmToSession(request, authority, {");
    // Log out pins the session before it reads anything, and confirms with that same authority.
    const signOut = between(settings, "async function signOutChecked()", "async function completeSignOut()");
    expect(signOut.indexOf("const authority = await captureConfirmAuthority();")).toBeLessThan(signOut.indexOf("getReviewSyncDiagnostics()"));
    expect(signOut).toContain("}, authority);");
  });

  it("keeps Log out reachable after a logout that failed partway, bound to that state (Codex r2)", () => {
    const signOut = between(settings, "async function signOutChecked()", "async function completeSignOut()");
    expect(signOut).toMatch(/if \(!authority\) \{\s*\/\/[^\n]*\n\s*await offerLogoutRecovery\(\);\s*return;\s*\}/);
    const recovery = between(settings, "async function offerLogoutRecovery()", "async function confirmForSession(");
    expect(recovery).toContain("const recovery = await captureLogoutRecovery();");
    // Never silent: a session change in progress says so; nothing left goes to sign-in.
    expect(recovery).toContain('settingsNotice.show("Your sign-in is changing. Try Sign out again in a moment.");');
    expect(recovery).toMatch(/if \(recovery\.kind === "signed_out"\) \{\s*finishSignedOutNavigation\(\);/);
    // The cleanup runs through the same logout path, only while the recovered state is still current.
    expect(recovery).toContain("void logoutRecoveryStillCurrent(recovery).then(");
    expect(recovery).toContain("if (current) void completeSignOut();");
    expect(recovery).toContain("else settingsNotice.show(ACCOUNT_CHANGED_NOTICE);");
  });

  it("never lets a Log out tap end silently (Codex r3)", () => {
    // A sign-in that can't be read (Keychain locked or failing) says so with a retry.
    const signOut = between(settings, "async function signOut()", "async function signOutChecked()");
    expect(signOut).toMatch(/try \{\s*await signOutChecked\(\);\s*\} catch \{\s*settingsNotice\.show\(SIGN_IN_UNREADABLE_NOTICE\);/);
    expect(settings).toContain("const SIGN_IN_UNREADABLE_NOTICE = \"Unlock your iPhone and try again.\";");
    // A session change while the warning is prepared voids the tap and says so.
    const wrapper = between(settings, "async function confirmForSession(", "\n  }\n");
    expect(wrapper).toMatch(/confirmAuthorityStillCurrent\(authority\)\)\) \{\s*\/\/[^\n]*\n\s*settingsNotice\.show\(ACCOUNT_CHANGED_NOTICE\);\s*return false;/);
    expect(wrapper).toMatch(/\} catch \{\s*settingsNotice\.show\(SIGN_IN_UNREADABLE_NOTICE\);\s*return false;/);
  });

  it("starts the 'created but not pinned' notice only after the activity editor has left (Codex r1 #2)", () => {
    expect(settings).toContain("showAfterActivityEditor(`Quick start is full. ${result.category.name} was created but not pinned.`");
    expect(settings).toContain("activityEditorOpen.current = activityEditor !== null;");
    expect(settings).toMatch(/onClose=\{\(\) => \{\s*setActivityEditor\(null\);\s*activityEditorClosed\(\);/);
    const show = between(settings, "function showAfterActivityEditor(", "function activityEditorClosed(");
    expect(show).toContain("if (activityEditorOpen.current) noticeAfterActivityEditor.current = { message, swatchColor };");
  });

  it("turns quick-start limits and busy notices into toasts", () => {
    expect(settings).toContain("settingsNotice.show(`Quick start holds ${QUICK_START_PIN_LIMIT}. Unpin one first.`");
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
    // A start accepted after the account or session changed shows nothing (Codex r1 #4).
    expect(start).toContain("const noticeOwner = todayNoticeOwner();");
    expect(start.indexOf("if (!todayNoticeOwnerStill(noticeOwner)) return;")).toBeLessThan(start.indexOf("switchedToastMessage("));
    const signedOut = between(dashboard, "const transitionToSignedOut = useCallback(", "}, [clearTodayNotice]);");
    expect(signedOut).toContain("noticeSessionGeneration.current += 1;");
    expect(signedOut).toContain("clearTodayNotice();");
    expect(dashboard).toContain('todayNotice.notice && authState === "authenticated" ? (');
    // The delete Undo toast always holds the place.
    expect(dashboard).toContain('if (deletionCoordinator.current?.current()?.phase === "active") {');
    expect(dashboard).toMatch(/pendingDeletion\?\.phase === "active" \? \([\s\S]*?<BlocksToast[\s\S]*?\) : todayNotice\.notice && authState === "authenticated" \? \(/);
  });
});
