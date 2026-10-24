import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const deck = source("./ReviewDeck.tsx");
const screen = source("../../../app/review.tsx");
const answer = source("../../lib/reviewAnswer.ts");
const theme = source("../../lib/mobileTheme.ts");

function styleBlock(name: string) {
  const start = theme.indexOf(`${name}: {`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return theme.slice(start, theme.indexOf("}", start) + 1);
}

describe("Review deck motion contract (Blocks parity step 5b)", () => {
  it("gives the top card one pan owner that leaves the vertical axis to pull-to-refresh", () => {
    expect(deck).toContain("Gesture.Pan()");
    expect(deck).toContain(".enabled(top)");
    expect(deck).toContain(".activeOffsetX([-12, 12])");
    expect(deck).toContain(".failOffsetY([-14, 14])");
    expect(deck).toContain("runOnJS(playArmTick)()");
  });

  it("flies out, reports after the flight, and skips the flight with Reduce Motion", () => {
    expect(deck).toMatch(/if \(reduceMotion\) \{\s*runOnJS\(onThrow\)\(direction\);/);
    expect(deck).toContain("if (finished) runOnJS(onThrow)(direction);");
    expect(deck).toContain("withSpring(0, { ...BLOCKS_SPRING.sheet");
  });

  it("holds a thrown decision for Undo and saves it on leaving or backgrounding", () => {
    expect(screen).toContain("deckHold.hold({");
    expect(screen).toMatch(/return \(\) => \{\s*deckScreenFocused\.current = false;\s*deckScreenActive\.current = false;\s*deckHold\.flush\(\);\s*\};\s*\}, \[deckHold\]\)/);
    expect(screen).toMatch(/if \(state !== "active"\) deckHold\.flush\(\);/);
    expect(screen).toContain('actionTestID="review-deck-undo"');
    expect(screen).toContain("unrecordDeckDecision(");
  });

  it("keeps a saved decision out of the deck until its projection lands (r2 A)", () => {
    expect(screen).toContain("committingDeckKeys.has(key)");
    // An outing's Moves stay out with its Stay's card (PRD D19, PR 12b).
    expect(screen).toContain("const committingKeys = [held.key, ...memberKeys];");
    expect(screen).toContain("setDeckKeysCommitting(committingKeys, true);");
    // One save for every choice, from the shared rule (reviewAnswer.ts, location v4 step 14 part 3b).
    expect(screen).toMatch(/const started = resolveItem\(\s*item,\s*reviewAnswerMutation\(item, held\.logged, \{ edit, outingMemberIds: [^\n]*\),[\s\S]*?settled,\s*failed,\s*outing \? \{ unlisted, affectedItems: \[item, \.\.\.members\] \} : \{ unlisted \}\s*\);/);
    expect(answer).toContain('if (edit) return { action: "edit_and_confirm", edit };');
    expect(screen).toContain("if (!started) failed();");
    expect(screen).toContain("const claimed = () => affected.some((candidate) => reviewMutations.current.has(candidate.id));");
    expect(screen).toContain("if (claimed()) return false;");
  });

  it("folds an outing's Moves into its Stay's card and decides them together (PRD D19, PR 12b)", () => {
    expect(screen).toContain('const folded = (source: DeckSource) => source.kind === "review" && deckOutings.anchorByMember.has(source.item.id);');
    expect(screen).toContain("sources = sources.filter((source) => !folded(source));");
    // A Today ribbon focus on a folded Move leads with its outing's card.
    expect(screen).toContain('const focusTarget = focusedAnchor ? reviewFocusKey("review", focusedAnchor) : highlightedFocusKey;');
    // One outbox row on the Stay's card hides every part; Undo and a failed save bring every part back.
    expect(screen).toContain("{ unlisted, affectedItems: [item, ...members] }");
    expect(screen).toContain("for (const member of held.outing?.members ?? []) restorePagedOutDeckItem(member.itemId);");
    expect(screen).toMatch(/const failed = \(\) => \{[\s\S]*?restoreMembers\(\);[\s\S]*?undoCount\(\);/);
    expect(deck).toContain('testID="review-deck-outing"');
    // A focused Move opens its outing in the Stay's segment (a trip after midnight; Codex r1 on #473).
    expect(screen).toContain("beginExactFocus(focusKey, reviewDeckSegmentFor(reviewItemMoment(shown), reviewDeckToday(Date.now())));");
    // The outing is one decision of this visit: its Moves never count toward "N of M".
    expect(screen).not.toMatch(/ownDeckDecisionKeys\.current\.(add|delete)\(member/);
  });

  it("does not count the held card in flight toward \"N of M\" (r2 B)", () => {
    expect(screen).toContain("const deckRemaining = heldInFlight ? deckSources.length - 1 : deckSources.length;");
    // Since the Today · Earlier segments (14 Oct 2026) each segment counts its own cards (exact once
    // the whole backlog is loaded); "N of M" never drops below the deck itself.
    expect(screen).toContain("backlogComplete: deckBacklogComplete");
    expect(screen).toContain("remaining: Math.max(segmentCounts[deckSegment].value, deckRemaining),");
    expect(screen).toContain('today: deckSegment === "today" ? deckRemaining : deckSegmentSources.today.length,');
    expect(screen).not.toMatch(/remaining: deckBacklogComplete\s*\?\s*deckSources\.length/);
  });

  it("hangs the All framed Undo toast out of flow so its exit moves nothing (r2 C)", () => {
    expect(screen).toContain("styles.reviewDeckToastUnderButton");
    expect(screen).not.toContain("reviewDeckToastInFlow");
    expect(deck).toContain("deckStyles.finishedActions");
  });

  it("celebrates after any own decision and locks the flying card's controls (r2 D, F)", () => {
    expect(screen).toContain("celebrate={celebrateDeckFinish.current}");
    expect(screen).toContain("lastDeckKeys.current.every((key) => ownDeckDecisionKeys.current.has(key))");
    expect(screen).not.toContain("lastDeckDecisionAt");
    expect(screen).toContain("controlsDisabled: card.controlsDisabled || card.key === flyingDeckKey");
    expect(screen).toContain("logDisabled={topDeckControlsDisabled || deckFlying}");
    expect(screen).toContain("skipDisabled={deckFlying || (topDeckSkipDefers && deckSources.length <= 1)}");
    expect(deck).toContain("reviewDeckArmDirection(dragX.value, event.translationX)");
  });

  it("hangs the Undo toast below the round actions, never over the card (staging feedback C1)", () => {
    const reserve = Number(deck.match(/export const REVIEW_DECK_TOAST_RESERVE = (\d+);/)?.[1]);
    expect(reserve).toBeGreaterThanOrEqual(52 + 12);
    // The anchor around the actions always reserves the toast's room under itself.
    const anchor = styleBlock("reviewDeckActionsAnchor");
    expect(anchor).toContain(`marginBottom: ${reserve}`);
    expect(anchor).toContain('position: "relative"');
    // The toast starts 12 points under the actions' bottom edge, out of flow.
    const toast = styleBlock("reviewDeckToast");
    expect(toast).toContain('position: "absolute"');
    expect(toast).toContain('top: "100%"');
    expect(toast).toContain("marginTop: 12");
    expect(toast).not.toContain("bottom:");
    // Rendered after the actions inside their anchor (below them for VoiceOver too).
    expect(screen).toMatch(/<View style=\{styles\.reviewDeckActionsAnchor\}>\s*<ReviewDeckActions[\s\S]*?\/>\s*\{\/\*[^*]*\*\/\}\s*\{deckToastSlot\("actions"\)\}\s*<\/View>/);
    expect(screen).toContain('placement === "under" ? styles.reviewDeckToastUnderButton : styles.reviewDeckToast');
    expect(styleBlock("reviewDeckWaitingContent")).toContain(`paddingBottom: ${reserve}`);
  });

  it("names a logged card's toast by its Log as name (staging feedback C2)", () => {
    expect(screen).toMatch(/const decisionName = reviewDeckDecisionName\(\{\s*logged,\s*cardTitle: [^\n]*\n\s*edit: logged \? deckLogAsEdit\(item\) : null,\s*isLocationV2Commute: isLocationV2Commute\(item\),/);
    // The toast's name and the saved edit come from the same edit.
    expect(screen).toContain("const edit = held.logged ? deckLogAsEdit(item) : null;");
    expect(screen).toContain("AccessibilityInfo.announceForAccessibility(`${held.title} is back.`);");
    expect(screen).toContain("title: decisionName,");
    expect(screen).toContain('`${logged ? "Logged" : "Skipped"} ${decisionName}. Undo is available for a few seconds.`');
    expect(screen).not.toContain("title: card?.title ?? reviewItemTitle(item),");
  });

  it("keeps Undo in every deck state and never decides a cancelled gesture (r3 1, 2)", () => {
    // Under Back to Today ("All framed"), under the waiting copy and under "Today is framed".
    expect(screen.match(/deckToastSlot\("under"\)/g)?.length).toBe(3);
    expect(screen).toContain('deckToastSlot("actions")');
    // Investigation 2026-10-12: a branch change must hand the same toast over, never ghost it.
    expect(screen).toMatch(/function deckToastSlot[\s\S]*?<LayoutAnimationConfig skipExiting>\s*\{renderDeckToast\(placement\)\}/);
    expect(deck).toContain(".onEnd((_event, success) => {");
    expect(deck).toContain("if (direction !== 0 && success && allowed) {");
  });

  it("retires a cut-short flight on the save outcome and flushes a held card on any decision (r3 3, 4)", () => {
    expect(screen).toMatch(/const settled = \(\) => \{\s*setDeckKeysCommitting\(committingKeys, false\);[\s\S]*?setFlyingDeckKey/);
    expect(screen).toMatch(/if \(claimed\(\)\) return false;\s*\/\/[^\n]*\n\s*deckHold\.flush\(\);/);
    expect(screen).toMatch(/if \(!editTarget\) return false;\s*\/\/[^\n]*\n\s*deckHold\.flush\(\);/);
  });

  it("locks a deferred card's controls during its flight too (r3 6)", () => {
    expect(screen).toMatch(/setFlyingDeckKey\(key\);\s*flyingDeckDefers\.current = [^\n]*\n\s*if \(source\.kind === "legacy_entry" \|\| card\?\.skipDefers\) \{\s*\/\/[^\n]*\n\s*deckHold\.flush\(\);/);
  });

  it("restores a failed save as a fresh card and never saves a changed proposal (r4 1, 2)", () => {
    expect(screen).toMatch(/const failed = \(\) => \{[^}]*deferGenerations\.current\.set\(held\.key/);
    expect(screen).toContain("proposal: reviewDeckProposalSignature(item)");
    // A held outing saves nothing when any of its Moves changed too (PRD D19, PR 12b).
    expect(screen).toContain("if (reviewDeckProposalSignature(item) !== held.proposal || members === null) {");
  });

  it("saves a throw reported after leaving at once, and Undo beats a ribbon focus (r4 3, 4)", () => {
    expect(screen).toContain("if (!deckScreenActive.current) deckHold.flush();");
    expect(screen).toMatch(/deckScreenActive\.current = false;\s*deckHold\.flush\(\);/);
    expect(screen).toContain("orderReviewDeck(ordered, returnKey ?? focusKey ?? stickyKey)");
  });

  it("counts Dismiss, a saved edit and a bulk skip as this visit's own decisions for the celebration (r4 5, 5f)", () => {
    expect(screen.match(/ownDeckDecisionKeys\.current\.add\(reviewFocusKey\("review", (item|editTarget\.item)\.id\)\)/g)?.length).toBe(3);
  });

  it("saves a paged-out held card, keeps Undo reachable and drops the tilt with Reduce Motion (r5)", () => {
    expect(screen).toContain("const unlisted = !listedItem;");
    expect(screen).toContain("if (!listed && !options.unlisted) return false;");
    expect(deck).toContain("paddingBottom: REVIEW_DECK_TOAST_RESERVE");
    expect(deck).toContain('rotate: reduceMotion ? "0deg"');
  });

  it("never flies a direction the card lost mid-drag; keeps pending saves hidden; restores paged-out Undo (r6)", () => {
    expect(deck).toContain("const allowed = direction === 1 ? canLog : canSkip;");
    expect(deck).toContain("if (direction !== 0 && success && allowed) {");
    expect(screen).toContain('!open.has(key) && !reviewMutations.current.has(key.slice(key.indexOf(":") + 1))');
    expect(screen).toContain("commitData({ ...loaded, reviewItems: [...loaded.reviewItems, known] });");
    expect(screen.match(/restorePagedOutDeckItem\(held\.itemId\);/g)?.length).toBe(3);
    expect(screen).toContain("if (deckReturn && !deckSources.some((source) => source.key === deckReturn.key)) setDeckReturn(null);");
    expect(deck).toContain("if (throwRequest.direction === 1 ? !canLog : !canSkip) return;");
    expect(screen).toContain('deckScreenActive.current = state === "active" && deckScreenFocused.current;');
  });
});

describe("Review deck live Log as (Blocks parity step 5c-1)", () => {
  it("edits the name and activity on the card and logs them as edit_and_confirm after the hold", () => {
    expect(deck).toContain('testID="review-deck-log-as-name"');
    expect(deck).toContain('testID="review-deck-log-as-activity"');
    expect(screen).toContain("<ActivityPickerSheet");
    // The edit is decided when the hold ends, from what really changed (src/lib/reviewLogAs.ts).
    expect(screen).toContain("const edit = held.logged ? deckLogAsEdit(item) : null;");
    expect(screen).toMatch(/function deckLogAsEdit\(item: MobileReviewItem\) \{\s*return reviewLogAsEdit\(\{/);
    expect(answer).toContain('if (edit) return { action: "edit_and_confirm", edit };');
    // The field is uncontrolled and its touches never start a throw.
    expect(deck).toContain("defaultValue={card.logAsName}");
    expect(deck).toContain(".requireExternalGestureToFail(logAsFieldGesture)");
    expect(screen).toContain("logAsEditable: context.syncState == null && hasSuggestedTimeWindow(item)");
  });

  it("never throws a card the outbox would refuse, and a dead card never reports a throw (polish)", () => {
    expect(screen).toContain("canLog: context.syncState == null && hasSuggestedTimeWindow(item),");
    expect(screen).toContain("skipDefers: context.syncState != null || !hasSuggestedTimeWindow(item),");
    expect(screen).toContain("controlsDisabled: context.syncState != null || !hasSuggestedTimeWindow(item),");
    expect(screen).toMatch(/reviewItemSyncStates\.has\(item\.id\) \|\|\s*!hasSuggestedTimeWindow\(item\)/);
    expect(screen).toContain("deferDeckCard(flyingDeckKey);");
    expect(deck).toMatch(/useEffect\(\(\) => \(\) => \{\s*cancelAnimation\(dragX\);\s*cancelAnimation\(dragY\);/);
  });

  it("announces Skip for now and retires any flight whose card a refresh dropped (follow-ups)", () => {
    expect(screen).toContain("moved behind the rest.`);");
    expect(screen).toMatch(/if \(flyingDeckKey && !deckSources\.some\(\(source\) => source\.key === flyingDeckKey\)\) \{/);
  });

  it("never lets the full-screen back gesture race a card drag, and lands the next card as the throw starts (5d)", () => {
    const layout = source("../../../app/_layout.tsx");
    expect(layout).toContain('<Stack.Screen name="review" options={{ title: "Review", gestureEnabled: false }} />');
    expect(screen).toContain("flyingKey={flyingDeckKey}");
    expect(deck).toContain("const topFlying = Boolean(flyingKey) && cards[0]?.key === flyingKey;");
    expect(deck).toContain("const top = depth === 0 && !flying && !locked;");
    expect(deck).toContain("locked={topFlying && !flying}");
    expect(deck).toContain("const sizingCard = visible[topFlying ? 1 : 0] ?? visible[0];");
  });

  it("holds a bulk skip as one decision with one Undo, through the same hold as a throw (5f)", () => {
    const menu = source("../OverflowMenu.tsx");
    expect(menu).toContain(">Skip older than 7 days</Text>");
    // Scoped to the selected segment (14 Oct 2026): "Skip all earlier" or "Skip all today".
    expect(menu).toContain('{bulkSkip === "earlier" ? "Skip all earlier" : "Skip all today"}</Text>');
    expect(screen).toContain("<OverflowMenu\n        bulkSkip");
    // One hold for single cards and batches: a throw saves a held batch first, leaving saves it.
    expect(screen).toContain('kind: "batch",');
    expect(screen).toMatch(/if \(held\.kind === "batch"\) \{\s*commitHeldBulkSkip\(held\);/);
    expect(screen).toMatch(/if \(held\.kind === "batch"\) \{\s*undoHeldBulkSkip\(held\);/);
    // Every card the batch covers is hidden while held, even the one on top.
    expect(screen).toContain('heldDeckDecision?.kind === "batch" || key !== flyingDeckKey');
    // Skip once only: never Log, never a rule.
    expect(screen).toContain('mutation: hasV2LocationEvidence(item) ? { action: "ignore_once_location" } : { action: "ignore_once" },');
    // Saved through runReviewBulkSkip (behaviour in reviewBulkSkip.run.test.ts), fenced to the
    // account that held it; nothing is put back once the account changed.
    expect(screen).toContain("await runReviewBulkSkip<MobileReviewItem>(claimed, {");
    expect(screen).toMatch(/\/\/ Nothing is put back once the account has changed\.\s*if \(!ownerMatches\(\)\) return;/);
    // The batch is bound to the account that held it: the hold end and Undo are both fenced, and
    // remembered cards are forgotten when another account's data arrives.
    expect(screen).toContain("owner: { workspaceId: loaded.workspace.id, userId: loaded.user.id },");
    expect(screen).toContain("const ownerMatches = () => reviewBulkSkipOwnerMatches(held.owner, dataRef.current);");
    expect(screen).toMatch(/if \(!reviewBulkSkipOwnerMatches\(held\.owner, dataRef\.current\)\) return;\s*for \(const item of held\.items\) restorePagedOutDeckItem/);
    expect(screen).toMatch(/reviewBacklogRef\.current = null;\s*\/\/ Cards the deck remembers[^\n]*\n\s*knownDeckItems\.clear\(\);/);
    // Remembered cards are tagged with their account and read back only for it (behaviour in
    // reviewKnownItems.test.ts), so a late effect after an account change cannot leak one.
    expect(screen).toContain("knownDeckItems.remember(item, deckOwnerKey);");
    expect(screen).toContain("return knownDeckItems.get(itemId, dataRef.current);");
    expect(screen).not.toMatch(/knownDeckItems\.current/);
    // A single decision whose flush saved the same item through a batch stops there.
    expect(screen).toMatch(/deckHold\.flush\(\);\s*\/\/ That flush may have saved this very item[^\n]*\n\s*if \(claimed\(\)\) return false;/);
    // The longer menu stays inside the screen with a visible Cancel.
    expect(menu).toContain("maxHeight: windowHeight - insets.top");
    expect(menu).toContain(">Cancel</Text>");
    // One confirmation that states the count, after older pages are read.
    expect(screen).toContain("reviewBulkSkipConfirmation(candidates.length, scope, complete, segment)");
    // Only the segment the bulk skip started in (14 Oct 2026), by the deck's own Today predicate;
    // the confirmed batch is recomputed for the same segment.
    expect(screen).toContain("const segment = deckSegmentRef.current;");
    expect(screen).toContain("inSegment: (item) => reviewDeckSegmentFor(reviewItemMoment(item), today) === segment,");
    expect(screen).toContain("holdBulkSkip(bulkSkipCandidates(scope, segment).filter((item) => chosen.has(item.id)));");
    expect(screen).toContain("await inFlight.done;");
  });


  it("gives the Log-as row one geometry on the top card and beneath it (investigation 2026-10-12)", () => {
    // The top card's 44-point field and activity button; every other card the same 44-point slots.
    expect(deck).toMatch(/deckStyles\.logAsName, deckStyles\.logAsStaticName/);
    expect(deck).toMatch(/deckStyles\.activityChip, deckStyles\.activityChipButton, \{ backgroundColor: card\.color \}\]\}>/);
    expect(deck).toMatch(/logAsStaticName: \{\s*justifyContent: "center",\s*minHeight: 44/);
  });

  it("starts a handed-over toast settled, so its later exit starts from rest (Codex r1 on #373)", () => {
    const toast = source("../blocks/BlocksToast.tsx");
    expect(toast).toContain('useSharedValue<ToastPhase["value"]>(appearSettled ? "settled" : "entering")');
    expect(screen).toContain("appearSettled={shownDeckToastKeysRef.current.has(String(held.token))}");
    expect(screen).toContain("appearSettled={shownDeckToastKeysRef.current.has(`notice-${notice.token}`)}");
    expect(screen).toContain("shownDeckToastKeysRef.current = new Set(activeDeckToastKey ? [activeDeckToastKey] : []);");
    // Only a handoff skips the entrance; a toast first raised with a branch change still rises in.
    expect(toast).toContain("entering={appearSettled ? undefined : blocksToastEntering(reduceMotion, phase)}");
    expect(screen).not.toContain("skipEntering");
  });
});

