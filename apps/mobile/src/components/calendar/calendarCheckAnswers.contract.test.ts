import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const dashboard = source("../DayframeDashboard.tsx");
const theme = source("../../lib/mobileTheme.ts");

describe("Calendar › List answers and Today's toasts (Codex r2 on #582)", () => {
  it("stacks the answer's toast above a delete's or a notice in one measured column, never at a fixed offset", () => {
    const stackAt = dashboard.indexOf('testID="today-toast-stack"');
    expect(stackAt).toBeGreaterThan(-1);
    expect(dashboard).toContain('<View pointerEvents="box-none" style={[styles.todayToast, styles.todayToastStack]} testID="today-toast-stack">');
    const stack = dashboard.slice(stackAt, dashboard.indexOf("<PlayOrb", stackAt));
    // The answer first (on top), then the delete or the notice (on the bottom edge), each without a place of its own.
    expect(stack.indexOf('testID="calendar-check-toast"')).toBeLessThan(stack.indexOf('testID="today-delete-toast"'));
    expect(stack.indexOf('testID="today-delete-toast"')).toBeLessThan(stack.indexOf('testID="today-notice-toast"'));
    expect(stack).not.toContain("style={styles.todayToast}");
    expect(dashboard).not.toContain("bottom: 164");
    expect(theme).toMatch(/todayToastStack: \{\s*flexDirection: "column",\s*justifyContent: "flex-end",\s*gap: 8\s*\}/);
  });

  it("offers no answers in a build without a backend identity, where the outbox's record is not read (Codex r9 on #582)", () => {
    expect(dashboard).toContain("ownerKey: scopedOwnerKey ?? null,");
    expect(dashboard).toContain("onAnswerCheck={scopedOwnerKey\n");
    expect(dashboard).toContain("? (id, logged) => checkAnswers.answer(id, logged, id === openCalendarCheckId ? openCheckVenue.venue : null)\n                    : undefined}");
    expect(dashboard).not.toContain('"local"');
  });

  it("opens each \"?\" where its kind is handled, and asks none with a pending change of its own (Codex r10 on #582)", () => {
    expect(dashboard).toContain("onOpenCheck={(reviewItemId) => {");
    // A trip's question edits the trip on its own correction sheet (step 12, Codex r1 on #602): the List opens it
    // itself (Codex r2 on #610).
    expect(dashboard).toContain("onOpenTripLeg={locationCorrections.openTripLeg}");
    // Step 15: no "?" opens a Review screen; the List's own fallback opens the sheet when the day has one.
    expect(dashboard).toContain("openCheckSheet(reviewItemId);");
    expect(dashboard).not.toContain("calendarCheckRoute");
    expect(dashboard).not.toMatch(/pathname: "\/review/);
    expect(dashboard).toContain("pendingChange: reviewSyncStateIds.has(item.id)");
  });

  it("folds, asks, counts and saves the List's outings with the deck's eligibility", () => {
    expect(dashboard).toContain("return { open, ...calendarCheckOutings(open, reviewSyncStateIds) };");
    expect(dashboard).toContain("const { open, outings, folded } = calendarCheckBase;");
    expect(dashboard).toContain("Promise.all([readSuppressedReviewItemIds(scopedOwner), getReviewItemSyncStates()])");
    expect(dashboard).not.toContain("foldedOutingMemberIds(");
  });
});

describe("the Dashboard's sheet answers, Logs as and \"?\" kinds (Codex r2 on #610)", () => {
  it("keeps a sheet answer with changes on the phone before its corrections, and hides it while it waits", () => {
    // Every sheet answer, with or without new changes, through the one shared registration (Codex r6 on #610).
    expect(dashboard).toContain("const record = await waitForItemCorrections(correctionOwner, { id, itemId: check.segmentId, newIds: ids,");
    // Without new changes, through checkAnswers.answer, which is itself gated (Codex r7 on #610).
    expect(dashboard).toContain("onAnswer: (yes) => checkAnswers.answer(check.id, yes, check.id === openCalendarCheckId ? openCheckVenue.venue : null),");
    expect(dashboard).not.toContain("holdAnswerAfterCorrections(");
    // And every Logs as path in the place sheets.
    const corrections = source("./useLocationCorrections.tsx");
    expect(corrections).toContain("await waitForItemCorrections(owner, { id, itemId: placeItemId, newIds, action: { kind: \"log\", categoryId } });");
    expect(corrections).not.toContain("holdAnswerAfterCorrections(");
    // Started through the store's one completion path (Codex r14 on #610).
    expect(dashboard).toContain("checkAnswers.startAfterCorrections(check.id, yes, id, registeredFor, registeredOwner, generation);");
    expect(dashboard).toContain("const answersAfterCorrections = useAnswersAfterCorrections({ data: shownCalendarData, owner: correctionOwner,");
    expect(dashboard).toContain("onDropped: (reviewItemIds) => checkAnswers.restoreAnswered(reviewItemIds) });");
    expect(dashboard).toContain("&& !answersAfterCorrections.waitingIds.has(item.id)");
  });

  it("hides the \"?\" a Logs as resolved on the server (#609) at once", () => {
    expect(dashboard).toContain("correctionQueue.acknowledged.flatMap((item) => item.resolvedReviewItemIds ?? [])");
    expect(dashboard).toContain("!resolvedByCorrections.has(item.id)");
  });

  it("classifies each \"?\" so only Apple Health's and a legacy one without a segment ask under their row, and never sends a row to Review", () => {
    expect(dashboard).toContain("kinds: new Map(items.map((item) => [item.id, calendarCheckKind(item)] as const)),");
    expect(dashboard).toContain("checkKinds={calendarChecks.kinds}");
    expect(dashboard).toContain('if (isLocationReviewItem(item) && segmentId) return item.eventType === "commute_detected" ? "trip" : "place";');
    // onOpenCheck is the List's own fallback only; it no longer looks a trip up by its kind.
    expect(dashboard).not.toContain('each.kind === "trip" && each.id === segmentId && !each.blockIds.length');
  });
});

describe("the one gated answer entry point (Codex r7 on #610)", () => {
  const hook = source("./useCalendarCheckAnswers.ts");
  const list = source("./CalendarListView.tsx");
  it("gates every answer in checkAnswers.answer itself, so no caller can go ahead of a queued correction", () => {
    const answerAt = hook.indexOf("const answer = useCallback(");
    const answer = hook.slice(answerAt, hook.indexOf("const undo = useCallback(", answerAt));
    expect(answer).toContain("void waitForItemCorrections(");
    expect(answer).toContain("newIds: []");
    // The hold itself is internal: only `answer` reaches it, and the hook returns `answer`, never `holdAnswer`.
    expect(hook).toContain("return { answer, canAnswer: canAnswerNow, data: shown, held: shownHeld, hiddenIds, restoreAnswered, startAfterCorrections, undo };");
    // Every late start of a waiting record, in the answers hook and the place sheets, goes through one completion path.
    expect(hook).toContain("finishWaitingStart(recordOwner, recordId, {");
    expect(source("./useLocationCorrections.tsx")).toContain("finishWaitingStart(owner, id, {");
    expect(hook).not.toMatch(/return \{[^}]*holdAnswer/);
  });

  it("leaves Calendar › List's row Yes and inline answers to the caller's onAnswerCheck, which is checkAnswers.answer", () => {
    // The List never saves an answer itself.
    expect(list).not.toContain("enqueueReviewMutation");
    expect(list).not.toMatch(/import [^;]*useCalendarCheckAnswers/);
    expect(list).not.toContain("waitForItemCorrections");
    expect(list).toContain("onYes={onAnswerCheck ? (id) => answerCheck(id, true) : undefined}");
    expect(list).toContain("onAnswerCheck?.(id, logged);");
    expect(dashboard).toContain("? (id, logged) => checkAnswers.answer(id, logged, id === openCalendarCheckId ? openCheckVenue.venue : null)");
  });
});

describe("waiting records are written only through the store's shared paths (Codex r12 on #610)", () => {
  it("leaves the raw commit and delete to the store and its recovery runner", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== "node_modules") walk(path);
        } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) sources.push(path);
      }
    };
    walk(join(root, "src"));
    walk(join(root, "app"));
    const raw = sources.filter((path) => !path.endsWith("reviewAnswersAfterCorrections.ts")
      && /\b(commitAnswerAfterCorrections|cancelAnswerAfterCorrections)\b/.test(readFileSync(path, "utf8")));
    expect(raw).toEqual([]);
    for (const path of ["./useCalendarCheckAnswers.ts", "./useLocationCorrections.tsx"]) {
      expect(source(path)).toMatch(/settleAnswerAfterCorrections|withdrawAnswerAfterCorrections/);
    }
  });
});

describe("one guarded notifier for the answer, Logs as and recovery flows (Codex r15 on #610)", () => {
  // Every notice, alert and announcement in these files is said inside the guarded notifier (or its hook's wrapper).
  const unguarded = (text: string, wrappers: readonly string[]) => {
    const lines = text.split("\n");
    return lines.flatMap((line, index) => {
      if (!/\b(showNotice\(|Alert\.alert\(|announceForAccessibility\()/.test(line)) return [];
      if (/=> showNotice\(message\)\);?$/.test(line.trim()) || /\(\) => showNotice\(message\)\)/.test(line)) return [];
      const window = lines.slice(Math.max(0, index - 3), index + 1).join("\n");
      return wrappers.some((wrapper) => window.includes(wrapper)) ? [] : [`${index + 1}: ${line.trim()}`];
    });
  };
  it("routes every notice in the answers hook, the place sheets and the recovery runner through it", () => {
    expect(unguarded(source("./useCalendarCheckAnswers.ts"), ["sayFor("])).toEqual([]);
    expect(unguarded(source("./useLocationCorrections.tsx"), ["sayForLog(", "sayIfStillHere("])).toEqual([]);
    expect(unguarded(source("./useAnswersAfterCorrections.ts"), ["sayIfStillHere("])).toEqual([]);
  });
});


describe("no Review screen on the iPhone (location v4 step 15)", () => {
  const layout = source("../../../app/_layout.tsx");
  const intent = source("../../../app/+native-intent.tsx");
  const ribbon = source("../today/TodayRibbon.tsx");
  it("has no Review route; an old Review link opens the Calendar tab with its check request", () => {
    expect(layout).not.toContain('name="review"');
    expect(intent).toContain("reviewLinkRedirect(path) ?? path");
    // Through the same check request the badge, the chips and the reminder use (#610), once the data is in.
    // Behaviour in useCheckLinks.test.tsx; here only that the Dashboard hands it the one check request, held until
    // signed in with the bootstrap in, and today's chip opener, which keeps today selected (Codex r1 on #615).
    expect(dashboard).toContain('ready: authState === "authenticated" && data !== null,');
    expect(dashboard).toContain("openCheck: (checkId, dayKey) => askingChecks.some((check) => check.id === checkId) && openCheckOn(checkId, dayKey),");
    expect(dashboard).toContain("openDay: openListDay,");
    expect(dashboard).toContain("openTodayFirst: openTodayChecks,");
    expect(dashboard).toContain("if (first && openCheckOn(first.id, today)) return;");
  });

  it("reprocesses Apple Health's \"?\" when Calendar › List is in front, whether or not capture is on (Codex r1 on #615)", () => {
    expect(dashboard).toContain('const calendarListInFront = authState === "authenticated" && appIsForeground && calendarOnScreen && calendarLayout === "list";');
    const effect = dashboard.slice(dashboard.indexOf("if (!calendarListInFront || !scopedOwnerKey) return;"), dashboard.indexOf("}, [calendarListInFront, scopedOwnerKey"));
    expect(effect).toContain("reprocessHealthOnCalendarFront({ ownerKey, isCurrentOwner: () => healthReprocessOwnerRef.current === ownerKey,");
    expect(effect).not.toContain("isHealthKitAutomaticSyncEnabled");
    // Foreground only (Codex r2 on #615): aborted on leaving the front, checked before every batch, reload deferred.
    expect(effect).toContain("isInFront: inFront, signal: controller.signal })");
    expect(effect).toContain('const inFront = () => calendarListInFrontRef.current && AppState.currentState === "active";');
    expect(effect).toContain("else healthReloadOnFront.current = true;");
    expect(dashboard).toContain("return () => controller.abort();\n  }, [calendarListInFront, scopedOwnerKey, transitionToSignedOut]);");
    expect(dashboard).toContain("if (!appIsForeground || !healthReloadOnFront.current) return;");
  });

  it("opens Today's hatched blocks in Calendar › List, never a pushed Review page", () => {
    expect(ribbon).not.toMatch(/router\.push\("\/review/);
    expect(ribbon).toContain("onOpenCheck(target.reviewItemId);");
    expect(dashboard).toContain("onOpenCheck={openTodayRibbonCheck}");
  });

  it("leaves a timer that ran into a trip out of every ordinary \"?\" until its block UI ships", () => {
    // List rows, the Grid's blocks (askingChecks), the badge, Today's chip and the reminder all read calendarCheckBase.
    expect(dashboard).toContain("isOpenReviewItem(item) && asksAsCheck(item) && !locallyDecidedIds.has(item.id)");
    expect(dashboard).toContain("useReviewNudgeCount(nudgeOwner, askingChecks.length,");
    expect(dashboard).toContain("const gridReviewItemIds = useMemo(() => new Set(askingChecks.map((check) => check.id)), [askingChecks]);");
    expect(source("../../lib/nativeCalendarPresentation.ts")).toContain("if (!isOpenReviewItem(item) || !asksAsCheck(item)) continue;");
    expect(source("../../lib/todayReviewPresentation.ts")).toContain('record.status !== "open" || !asksAsCheck(record)');
  });
});
