import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Alert, AppState } from "react-native";
import { outingKeyOf, timerTripClashQuestion } from "@dayframe/shared";
import type { MobileBootstrap, MobileReviewItem } from "../../lib/api";
import { currentMobileAccountEpoch, type MobileAccountOwner } from "../../lib/mobileAccount";
import { friendlyMobileErrorMessage } from "../../lib/friendlyError";
import { playHaptic } from "../../lib/haptics";
import { hasSuggestedTimeWindow, isLocationReviewItem, isOpenReviewItem } from "../../lib/review";
import { reviewAnswerMutation, timerTripClashProposalHash, type ReviewAnswerVenue } from "../../lib/reviewAnswer";
import { claimReviewAnswer, isReviewAnswerClaimed, releaseReviewAnswer, reviewAnswersDecided } from "../../lib/reviewAnswerClaims";
import { createReviewDeckHold, reviewDeckProposalSignature, type ReviewDeckHeld, type ReviewDeckHeldDecision } from "../../lib/reviewDeckHold";
import { heldOutingStillSame, reviewDeckOutings } from "../../lib/reviewDeckOutings";
import { createReviewClientMutationId, enqueueReviewMutation, synchroniseReviewMutations } from "../../lib/reviewSyncStore";
import { finishWaitingStart, settleAnswerAfterCorrections, withdrawAnswerAfterCorrections } from "../../lib/reviewAnswersAfterCorrections";
import { waitForItemCorrections } from "../../lib/afterCorrections";
import { sayIfStillHere } from "../../lib/guardedNotice";

/** A held answer, with the account that gave it. */
type HeldAnswer = ReviewDeckHeldDecision & {
  owner: string | null;
  /** The Apple place a Yes names (card B part 2): recorded there once. */
  venue?: ReviewAnswerVenue | null;
  /**
   * Answered from its sheet with changes of its own (Codex r2 on #610): its record waits, on the phone, for those
   * corrections (`reviewAnswersAfterCorrections`); the end of Undo lets it go once they are acknowledged.
   */
  afterCorrections?: string;
  /** Settled while the app was away or the List gone: saved at once, with nothing said (Codex r8 and r9 on #610). */
  quiet?: boolean;
  /** The account its waiting record was registered for: every write to it is made for that account (Codex r15). */
  recordOwner?: MobileAccountOwner;
};
/** The account a bootstrap belongs to, when it says. */
const accountOf = (data: MobileBootstrap | null | undefined): MobileAccountOwner | null =>
  data?.user?.id && data.workspace?.id ? { userId: data.user.id, workspaceId: data.workspace.id } : null;
/** What VoiceOver says an answer did: a block that ran into a trip is ended or kept; anything else logged or skipped. */
const answerVerb = (item: MobileReviewItem, logged: boolean) => timerTripClashQuestion(item)
  ? logged ? "Ended" : "Kept" : logged ? "Logged" : "Skipped";
/** An answer's set as tapped: its proposal, and an outing's members' proposals by id (Codex r9 on #610). */
type AnswerSet = { proposal: string; members: ReadonlyMap<string, string> };
/** Answers saving or saved whose hand-over to the outbox's own record is pending, for one account. */
type Saving = { owner: string | null; ids: ReadonlySet<string>; awaiting: ReadonlySet<string> };
/** Copies brought back (Undo, a failed or refused save) for suggestions the loaded data no longer lists. */
type Restored = { owner: string | null; base: MobileBootstrap | null; items: readonly MobileReviewItem[] };

/**
 * The outings Calendar › List asks about once, on their stay: the deck's own grouping and eligibility (a
 * complete window, no waiting or rejected change of its own), so what is folded, asked, counted and saved
 * is one map (Codex r2 on #582).
 */
export function calendarCheckOutings(open: readonly MobileReviewItem[], syncStateIds: ReadonlySet<string>) {
  const { outings } = reviewDeckOutings(open, (item) => isLocationReviewItem(item) && hasSuggestedTimeWindow(item)
    && !syncStateIds.has(item.id));
  const folded = new Set<string>();
  for (const outing of outings.values()) for (const member of outing.members) folded.add(member.id);
  return { outings, folded };
}

/**
 * The "?" still open as this phone has settled them (Codex r1 on #573, part 3b, #609, #610, #617): the data's open
 * suggestions less those decided here and not yet synced, held for Undo or saving, waiting for a sheet's corrections
 * (by id or by their place's segment), or resolved by an acknowledged correction (a Logs as, an outing's trips'
 * included), with the outings they fold. The one projection the Calendar (List, Grid, badge) and Today's Earlier
 * this week chips count from, so they never disagree while a refresh is out.
 */
export function settledCheckBase(reviewItems: readonly MobileReviewItem[], hidden: {
  decided: ReadonlySet<string>; answering: ReadonlySet<string>; resolved: ReadonlySet<string>;
  waitingIds: ReadonlySet<string>; waitingSegments: ReadonlySet<string>; syncStateIds: ReadonlySet<string>;
  /**
   * Whether a "?" still asks where it is answered (location v4 design §7): a block that ran into a trip asks only
   * while its block, as this iPhone has it, still runs into the trip, and only when it can be put on its block
   * (`clashAsksHere`). Absent: every open item asks.
   */
  stillAsks?: (item: MobileReviewItem) => boolean;
}) {
  // One filter for the List, the Grid, the badge, Today's chip and Earlier this week's chips (Codex r1 on #617, #618).
  const open = reviewItems.filter((item) => isOpenReviewItem(item) && (hidden.stillAsks?.(item) ?? true) && !hidden.decided.has(item.id)
    && !hidden.answering.has(item.id) && !hidden.resolved.has(item.id)
    // Hidden while a waiting record (held, committing or committed) answers it, the stay or an outing's trip; an
    // abandoned record never hides it (Codex r11 on #610).
    && !hidden.waitingIds.has(item.id)
    && !(typeof item.rawPayload?.clientSegmentId === "string" && hidden.waitingSegments.has(item.rawPayload.clientSegmentId)));
  return { open, ...calendarCheckOutings(open, hidden.syncStateIds) };
}

/** Whether a "?" can be answered in the List: a complete window and no waiting or rejected change of its own. */
export function calendarCheckAnswerable(item: MobileReviewItem, syncStateIds: ReadonlySet<string>) {
  return hasSuggestedTimeWindow(item) && !syncStateIds.has(item.id);
}

/**
 * Answers to Calendar › List's "?" (location v4 step 14, iPhone part 3b): the deck's "Log it" and "Skip",
 * with its Undo. An answer is held for the deck's Undo window (`createReviewDeckHold`, 4.8 s) and only then
 * saved, with the one rule both use (`reviewAnswerMutation`), so it is the deck's mutation exactly.
 *
 * As the deck does: a suggestion that changed (`reviewDeckProposalSignature`), whose outing changed
 * (`heldOutingStillSame`) or that was decided elsewhere while held is not saved; one a capped refresh only
 * left out of the loaded list is saved from the copy the List showed, once this phone is known not to have
 * decided it meanwhile; every save claims its suggestions, reads the outbox for them and checks again before
 * it is written (`reviewAnswersDecided`), so nothing the deck is saving or has saved is saved
 * again (`reviewAnswerClaims`); and Undo, or a save that fails or is refused, brings back a copy the loaded
 * list no longer has (outing included) until the next read replaces it (`data`). Everything belongs to the
 * account that answered: switching account drops a held answer unsaved and silences any late result. While
 * held or saving, its "?" (and an outing's folded trips) leave the List; once saved, it hands over to the
 * outbox's own record at its next read (shown again if that record does not hide it, a rejected answer
 * restored). Backgrounding the app saves a held answer at once, as in Review; so does the Dashboard going
 * away. VoiceOver hears the answer with its Undo, Undo's return, and the outcome, as on the deck.
 */
export function useCalendarCheckAnswers({ data, locallyDecidedIds, ownerKey, syncStateIds }: {
  /** The Calendar's bootstrap (its Review items included): what an answer is checked against and saved with. */
  data: MobileBootstrap | null;
  /** Suggestions already decided on this phone (the outbox's own record, read again on every Review sync). */
  locallyDecidedIds: ReadonlySet<string>;
  /** The signed-in account's scope: holds and saves belong to it. */
  ownerKey: string | null;
  /** Suggestions with a waiting or rejected change of their own, which never fold into an outing. */
  syncStateIds: ReadonlySet<string>;
}) {
  const [held, setHeld] = useState<HeldAnswer | null>(null);
  const [saving, setSaving] = useState<Saving | null>(null);
  const [restored, setRestored] = useState<Restored | null>(null);
  // The data the Calendar shows: the loaded data plus copies brought back, until the next read replaces it.
  const shownRestored = restored && restored.owner === ownerKey && restored.base === data ? restored.items : null;
  const shown = useMemo(() => data && shownRestored?.length
    ? { ...data, reviewItems: [...data.reviewItems, ...shownRestored.filter((item) => !data.reviewItems.some((loaded) => loaded.id === item.id))] }
    : data, [data, shownRestored]);
  const dataRef = useRef(data);
  const shownRef = useRef(shown);
  const ownerRef = useRef(ownerKey);
  const decidedRef = useRef(locallyDecidedIds);
  const syncStatesRef = useRef(syncStateIds);
  // The copy each held answer was made from, for an item a capped refresh leaves out (cleared per account).
  const known = useRef(new Map<string, MobileReviewItem>());
  const token = useRef(0);
  // The List's own lifetime: a held answer is still saved when it goes away, but nothing is said or shown
  // after it (Codex r4 on #582).
  const alive = useRef(true);
  // The one guarded notifier (Codex r15 on #610): said only while Dayframe is in front, the List is here (and the
  // answer not a quiet one), and the account is the one it was for.
  const sayFor = (owner: string | null, quiet: boolean | undefined, say: () => void) => sayIfStillHere({
    inFront: () => inFront.current, mounted: () => alive.current && !quiet, sameAccount: () => ownerRef.current === owner
  }, say);
  const savingRef = useRef(saving);
  // How each answer held or saving here went (Log it / End it, or not), for what the Calendar shows meanwhile.
  const answeredLogged = useRef(new Map<string, boolean>());

  const isOpen = (item: MobileReviewItem) => isOpenReviewItem(item) && !decidedRef.current.has(item.id);
  // Listed (or brought back) and open, listed and decided (undefined), or left out of the list (the known copy).
  const resolveOpen = (itemId: string) => {
    const listed = shownRef.current?.reviewItems?.find((candidate) => candidate.id === itemId);
    if (listed) return isOpen(listed) ? listed : undefined;
    const copy = known.current.get(itemId);
    return copy && isOpenReviewItem(copy) && !decidedRef.current.has(itemId) ? copy : undefined;
  };
  // Copies the loaded data no longer lists come back to the List, for the account that answered.
  const restore = (owner: string | null, itemIds: readonly string[]) => {
    if (owner !== ownerRef.current) return;
    const base = dataRef.current;
    const back = itemIds
      .filter((id) => !base?.reviewItems.some((loaded) => loaded.id === id))
      .flatMap((id) => {
        const copy = known.current.get(id);
        return copy && isOpenReviewItem(copy) && !decidedRef.current.has(id) ? [copy] : [];
      });
    if (!back.length) return;
    setRestored((now) => {
      const kept = now && now.owner === owner && now.base === base ? now.items.filter((item) => !back.some((copy) => copy.id === item.id)) : [];
      return { owner, base, items: [...kept, ...back] };
    });
  };

  // Claim, read the outbox, check again, save (Codex r6 on #582): the shared claim is held across the read,
  // so no save on another surface can start, or finish unseen, in between. After the read, the claim is let
  // go and the answer is validated, claimed and saved again in the same turn (`verified`), against the
  // suggestion as it is now (Codex r3).
  const save = (decision: HeldAnswer, verified = false) => {
    if (decision.owner !== ownerRef.current) {
      // Another account now: never saved there.
      if (decision.afterCorrections && decision.recordOwner) void withdrawAnswerAfterCorrections(decision.recordOwner, decision.afterCorrections);
      return;
    }
    const owner = decision.owner;
    const heldIds = [decision.itemId, ...(decision.outing?.members.map((member) => member.itemId) ?? [])];
    if (decision.afterCorrections) {
      // Its corrections change the suggestion, so it is not checked against the copy answered: its record waits
      // for them and then answers the "?" as the server has it (reviewAnswersAfterCorrections). Its record, not this
      // hook, keeps its "?" (an outing's trips too) out of the List from now: held, committing or committed records
      // hide them; an abandoned one shows them (Codex r11 on #610). The store's recovery runner carries on with a
      // record whose Undo's end couldn't be written, whatever becomes of this hook.
      // For the account it was registered for; the store writes only in that account's scope (Codex r15 on #610).
      const id = decision.afterCorrections;
      if (!decision.recordOwner) return;
      void settleAnswerAfterCorrections(decision.recordOwner, id, { inFront: alive.current && inFront.current }).then((outcome) => {
        if (outcome !== "abandoned" || ownerRef.current !== owner) return;
        restore(owner, heldIds);
        // Through the one guarded notifier, checked now the store has finished (Codex r12 and r15 on #610).
        sayFor(owner, decision.quiet, () => {
          AccessibilityInfo.announceForAccessibility("The answer wasn’t saved. It is still here to check.");
          Alert.alert("Calendar", "Couldn’t save this answer on this iPhone.");
        });
      });
      return;
    }
    const unhide = (ids: readonly string[]) => {
      if (ownerRef.current !== owner) return;
      setSaving((now) => now && now.owner === owner ? { ...now, ids: new Set([...now.ids].filter((id) => !ids.includes(id))) } : now);
    };
    // Said only while the List is here, for the account that answered.
    // A quiet answer (settled while away or gone) says nothing through its save either (Codex r9 on #610).
    const present = () => alive.current && ownerRef.current === owner && !decision.quiet;
    const notSaved = (error: unknown) => {
      unhide(heldIds);
      restore(owner, heldIds);
      sayFor(owner, decision.quiet, () => {
        AccessibilityInfo.announceForAccessibility("The answer wasn’t saved. It is still here to check.");
        Alert.alert("Calendar", friendlyMobileErrorMessage(error, "Couldn’t save this answer on this iPhone."));
      });
    };
    const item = resolveOpen(decision.itemId);
    if (!item) {
      // Decided elsewhere while held: it has already left the List. An outing's parts still open come back
      // to be asked on their own, even when a refresh paged them out (Codex r9 on #582).
      unhide(heldIds);
      restore(owner, heldIds);
      return;
    }
    const members = decision.outing
      ? heldOutingStillSame(decision.outing.members, outingKeyOf(item) === decision.outing.key ? decision.outing.key : null,
        resolveOpen, reviewDeckProposalSignature)
      : [];
    if (reviewDeckProposalSignature(item) !== decision.proposal || members === null || !hasSuggestedTimeWindow(item)) {
      unhide(heldIds);
      restore(owner, heldIds);
      sayFor(owner, decision.quiet, () => AccessibilityInfo.announceForAccessibility(`${decision.title} changed, so it was not saved. Check it again.`));
      return;
    }
    const affected = [item, ...members];
    const ids = affected.map((candidate) => candidate.id);
    const bootstrap = shownRef.current;
    const loadedData = dataRef.current;
    if (!bootstrap || !loadedData || ids.some((id) => isReviewAnswerClaimed(id))) {
      // Yielding to a save on the deck: every part comes back (paged-out ones from their copies), and what
      // that save decides leaves again at the outbox's next read; if it fails, it is still here (Codex r10).
      unhide(heldIds);
      restore(owner, heldIds);
      return;
    }
    const loaded = new Set(loadedData.reviewItems.map((candidate) => candidate.id));
    // Copies the List remembered (a capped refresh only paged them out, or brought back by Undo).
    const remembered = affected.filter((candidate) => !loaded.has(candidate.id));
    const listedIds = new Set(bootstrap.reviewItems.map((candidate) => candidate.id));
    const current = remembered.some((candidate) => !listedIds.has(candidate.id))
      ? { ...bootstrap, reviewItems: [...bootstrap.reviewItems, ...remembered.filter((candidate) => !listedIds.has(candidate.id))] }
      : bootstrap;
    // Out of the List from now until the outbox's record takes over (or it comes back).
    setSaving((now) => now?.owner === owner
      ? { ...now, ids: new Set([...now.ids, ...ids]) }
      : { owner, ids: new Set(ids), awaiting: new Set() });
    // Being saved on the deck now: that decision comes first, and the parts come back as above.
    if (!claimReviewAnswer(ids)) {
      unhide(heldIds);
      restore(owner, heldIds);
      return;
    }
    if (!verified) {
      void reviewAnswersDecided(current, ids).then((decided) => {
        releaseReviewAnswer(ids);
        if (ownerRef.current !== owner) return;
        if (!decided.size) {
          saveRef.current(decision, true);
          return;
        }
        // Decided meanwhile on this phone (the deck): not this answer's to save. Parts of an outing that are
        // still open come back to be asked on their own, even when a refresh paged them out (Codex r8 on #582).
        unhide(heldIds);
        restore(owner, heldIds.filter((id) => !decided.has(id)));
      }, (error: unknown) => {
        releaseReviewAnswer(ids);
        if (ownerRef.current !== owner) return;
        // The outbox could not be read: not saved, and the answer is still here, as after a failed save.
        notSaved(error);
      });
      return;
    }
    const settle = (ok: boolean) => {
      releaseReviewAnswer(ids);
      if (ownerRef.current !== owner) return; // Late for another account: no word of it there.
      if (ok) setSaving((now) => now && now.owner === owner ? { ...now, awaiting: new Set([...now.awaiting, ...ids]) } : now);
    };
    void enqueueReviewMutation({
      bootstrap: current,
      item,
      mutation: reviewAnswerMutation(item, decision.logged, {
        outingMemberIds: members.length ? ids.slice(1) : undefined,
        venue: (decision as HeldAnswer).venue ?? null
      }),
      clientMutationId: createReviewClientMutationId(),
      ...(members.length ? { affectedItems: affected } : {})
    }).then(() => {
      settle(true);
      if (ownerRef.current !== owner) return;
      void synchroniseReviewMutations().catch(() => undefined);
      sayFor(owner, decision.quiet, () => AccessibilityInfo.announceForAccessibility(`${answerVerb(item, decision.logged)}. Saved on this iPhone. Waiting to sync.`));
    }).catch((error) => {
      settle(false);
      if (ownerRef.current !== owner) return;
      notSaved(error);
    });
  };
  const saveRef = useRef(save);
  // The latest values for the hold's later callbacks (never written during render).
  useLayoutEffect(() => {
    dataRef.current = data;
    shownRef.current = shown;
    savingRef.current = saving;
    // A remembered copy follows every newer read of its suggestion, so one paged out later is checked as it
    // was last seen, never as it was when answered (Codex r3 on #582).
    for (const item of data?.reviewItems ?? []) if (known.current.has(item.id)) known.current.set(item.id, item);
    decidedRef.current = locallyDecidedIds;
    syncStatesRef.current = syncStateIds;
    saveRef.current = save;
  });

  const hold = useMemo(() => createReviewDeckHold({
    onChange: (current: ReviewDeckHeld | null) => setHeld(current?.kind === "single" ? current as HeldAnswer : null),
    onCommit: (current: ReviewDeckHeld) => {
      if (current.kind === "single") saveRef.current(current as HeldAnswer);
    }
  }), []);

  // Another account: a held answer is dropped unsaved, and nothing of the last account stays hidden or brought back.
  useLayoutEffect(() => {
    if (ownerRef.current === ownerKey) return;
    ownerRef.current = ownerKey;
    const current = hold.current();
    if (current) {
      hold.undo(current.token);
      const waiting = current as HeldAnswer;
      if (waiting.afterCorrections && waiting.recordOwner) void withdrawAnswerAfterCorrections(waiting.recordOwner, waiting.afterCorrections);
    }
    known.current.clear();
    answeredLogged.current.clear();
    setSaving(null);
    setRestored(null);
  }, [hold, ownerKey]);
  // A saved answer hands over at the outbox record's next read (a new set each read), whatever it says.
  const lastDecided = useRef(locallyDecidedIds);
  useEffect(() => {
    if (lastDecided.current === locallyDecidedIds) return;
    lastDecided.current = locallyDecidedIds;
    setSaving((now) => {
      if (!now || now.awaiting.size === 0) return now;
      return { ...now, ids: new Set([...now.ids].filter((id) => !now.awaiting.has(id))), awaiting: new Set() };
    });
  }, [locallyDecidedIds]);
  // Backgrounding saves a held answer now; so does the Dashboard going away. `inFront`: an answer whose gate settles
  // while the app is away is saved at once, as that flush would have (Codex r8 on #610).
  const inFront = useRef(true);
  useEffect(() => {
    alive.current = true;
    const subscription = AppState.addEventListener("change", (state) => {
      inFront.current = state === "active";
      if (state !== "active") hold.flush();
    });
    return () => {
      subscription.remove();
      // Unavailable first, so the flush's own outcomes say nothing (Codex r16 on #610).
      alive.current = false;
      hold.flush();
    };
  }, [hold]);

  /**
   * Holds an answer for Undo; a new answer saves the one held before it. `afterCorrections`: the id of its waiting
   * record. Whether it was taken. Only through `answer`, which decides first whether it must wait.
   */
  // `proposal`: the suggestion as it was when tapped; one that has changed since is never answered (Codex r8 on #610).
  // `quiet`: the app left (or the List went away) while the gate was answering: saved at once, with nothing said.
  // The one place every answer settles (Codex r9 on #610), whichever way it came in (the gate, or a sheet's own
  // registered changes): the lifecycle is read here, so an answer settling while the app is away or the List is gone
  // is saved at once, with no Undo hold, no haptic and nothing said, through its save too.
  const holdAnswer = useCallback((itemId: string, logged: boolean, venue?: ReviewAnswerVenue | null,
    options: { afterCorrections?: string; expected?: AnswerSet; outing?: boolean; recordOwner?: MobileAccountOwner } = {}): boolean => {
    // No account to answer for (Codex r8 on #582): nothing is held or saved.
    if (!ownerRef.current) return false;
    const quiet = !alive.current || !inFront.current;
    const listed = shownRef.current?.reviewItems?.find((candidate) => candidate.id === itemId);
    if (!listed || !isOpen(listed) || isReviewAnswerClaimed(itemId)) return false;
    const changed = () => {
      // Its times or place (or an outing's trips) changed while the gate answered: not this answer's to confirm (as
      // the deck's proposal_changed); the "?" stays to be checked again.
      sayFor(ownerRef.current, quiet, () => AccessibilityInfo.announceForAccessibility(`${listed.title?.trim() || "Suggestion"} changed, so it was not saved. Check it again.`));
      return false;
    };
    if (options.expected && reviewDeckProposalSignature(listed) !== options.expected.proposal) return changed();
    // Already answered (held, or saving and not yet handed over): a repeat tap never saves the first answer
    // early and so never takes its Undo away (Codex r4 on #582).
    const current = hold.current();
    const heldNow = current?.kind === "single"
      ? [current.itemId, ...((current as HeldAnswer).outing?.members.map((member) => member.itemId) ?? [])]
      : [];
    const savingNow = savingRef.current && savingRef.current.owner === ownerRef.current ? savingRef.current.ids : new Set<string>();
    if (heldNow.includes(itemId) || savingNow.has(itemId)) return false;
    // Every answer needs the suggestion's whole window (the outbox refuses one without), and none may have a
    // waiting or rejected change of its own (the deck's rule): such a "?" offers its own screen instead
    // (Codex r3 and r10 on #582).
    if (!calendarCheckAnswerable(listed, syncStatesRef.current)) return false;
    // End it is sent with the proposal it showed: an item without one (an older server) can only be kept.
    if (logged && timerTripClashQuestion(listed) && !timerTripClashProposalHash(listed)) return false;
    // The outing the List asks about: the one map it folds and counts with, over the items it shows (none
    // held or saving), so a trip answered on its own never joins it (Codex r5 on #582).
    const open = (shownRef.current?.reviewItems ?? []).filter((candidate) => isOpen(candidate)
      && !heldNow.includes(candidate.id) && !savingNow.has(candidate.id));
    // An answer after corrections is the "?" alone: its corrections reshape it, so an outing is not folded in.
    // A gated outing (`outing`) keeps its trips: its record waits for theirs too (Codex r10 on #610).
    const members = options.afterCorrections && !options.outing ? []
      : calendarCheckOutings(open, syncStatesRef.current).outings.get(listed.id)?.members ?? [];
    // A trip of it already saving on the deck: that decision comes first, and the outing leaves the List with it.
    if (members.some((member) => isReviewAnswerClaimed(member.id))) return false;
    // The whole answer set as tapped (Codex r9 on #610): an outing's membership and every member's proposal. An
    // answer after corrections is the "?" alone, so only its own proposal counts there.
    if (options.expected && (!options.afterCorrections || options.outing) && (members.length !== options.expected.members.size
      || members.some((member) => options.expected!.members.get(member.id) !== reviewDeckProposalSignature(member)))) return changed();
    const outingKey = members.length ? outingKeyOf(listed) : null;
    known.current.set(listed.id, listed);
    for (const member of members) known.current.set(member.id, member);
    token.current += 1;
    const title = listed.title?.trim() || "Suggestion";
    const decision: HeldAnswer = {
      kind: "single",
      token: token.current,
      key: listed.id,
      itemId: listed.id,
      logged,
      direction: logged ? 1 : -1,
      title,
      color: "",
      seconds: 0,
      proposal: options.expected?.proposal ?? reviewDeckProposalSignature(listed),
      owner: ownerRef.current,
      ...(logged && venue && !members.length ? { venue } : {}),
      ...(options.afterCorrections ? { afterCorrections: options.afterCorrections } : {}),
      ...(options.recordOwner ? { recordOwner: options.recordOwner } : {}),
      ...(quiet ? { quiet: true } : {}),
      ...(members.length && outingKey ? {
        outing: { key: outingKey, members: members.map((member) => ({ key: member.id, itemId: member.id,
        proposal: options.expected?.members.get(member.id) ?? reviewDeckProposalSignature(member) })) }
      } : {})
    };
    answeredLogged.current.set(listed.id, logged);
    hold.hold(decision);
    if (quiet) {
      // Saved now, as backgrounding (or the List going away) saves a held answer: no Undo window, nothing said.
      hold.flush();
      return true;
    }
    playHaptic(logged ? "reviewLog" : "reviewSkip");
    // As the deck says it (Codex r2 on #582): the answer, and that Undo is there while its window runs.
    sayFor(ownerRef.current, false, () => AccessibilityInfo.announceForAccessibility(`${answerVerb(listed, logged)} ${title}. Undo is available for a few seconds.`));
    return true;
    // The answers read the hook's refs, which hold the latest data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);
  // The answer set a tap is about: its proposal and, for an outing, each member's, as holdAnswer would fold them now.
  const answerSetOf = (listed: MobileReviewItem): AnswerSet => {
    const current = hold.current();
    const heldNow = current?.kind === "single"
      ? [current.itemId, ...((current as HeldAnswer).outing?.members.map((member) => member.itemId) ?? [])]
      : [];
    const savingNow = savingRef.current && savingRef.current.owner === ownerRef.current ? savingRef.current.ids : new Set<string>();
    const open = (shownRef.current?.reviewItems ?? []).filter((candidate) => isOpen(candidate)
      && !heldNow.includes(candidate.id) && !savingNow.has(candidate.id));
    const members = calendarCheckOutings(open, syncStatesRef.current).outings.get(listed.id)?.members ?? [];
    return { proposal: reviewDeckProposalSignature(listed), members: new Map(members.map((member) => [member.id, reviewDeckProposalSignature(member)])) };
  };
  const canAnswer = (itemId: string) => {
    if (!ownerRef.current) return false;
    const listed = shownRef.current?.reviewItems?.find((candidate) => candidate.id === itemId);
    if (!listed || !isOpen(listed) || isReviewAnswerClaimed(itemId) || registering.current.has(itemId)) return false;
    const current = hold.current();
    const heldNow = current?.kind === "single"
      ? [current.itemId, ...((current as HeldAnswer).outing?.members.map((member) => member.itemId) ?? [])]
      : [];
    const savingNow = savingRef.current && savingRef.current.owner === ownerRef.current ? savingRef.current.ids : new Set<string>();
    if (heldNow.includes(itemId) || savingNow.has(itemId)) return false;
    return calendarCheckAnswerable(listed, syncStatesRef.current);
  };
  const canAnswerRef = useRef(canAnswer);
  canAnswerRef.current = canAnswer;
  /**
   * Starts an answer whose waiting record is already registered (the gate's, or an edited sheet's) through the store's
   * one completion path (Codex r14 on #610): another account than the one it was registered for withdraws it; the List
   * gone or Dayframe away settles it at once, quietly; otherwise its Undo hold starts. A "?" that's no longer open, or
   * changed since the tap (`expected`), withdraws it.
   */
  const startWaitingAnswer = (itemId: string, logged: boolean, recordId: string, registeredFor: string | null,
    recordOwner: MobileAccountOwner, generation: number, options: { expected?: AnswerSet; outing?: boolean } = {}) => finishWaitingStart(recordOwner, recordId, {
    generation,
    sameAccount: () => ownerRef.current !== null && ownerRef.current === registeredFor,
    present: () => alive.current && inFront.current,
    valid: () => {
      const listed = shownRef.current?.reviewItems?.find((candidate) => candidate.id === itemId);
      if (!listed || !isOpen(listed)) return false;
      if (!options.expected) return true;
      if (reviewDeckProposalSignature(listed) !== options.expected.proposal) return false;
      if (!options.outing) return true;
      const members = answerSetOf(listed).members;
      return members.size === options.expected.members.size
        && [...members].every(([id, signature]) => options.expected!.members.get(id) === signature);
    },
    start: () => holdAnswer(itemId, logged, null, { afterCorrections: recordId, recordOwner, ...options })
  });
  const startWaitingAnswerRef = useRef(startWaitingAnswer);
  startWaitingAnswerRef.current = startWaitingAnswer;
  // Answers being registered (the gate's store read): a repeat tap on the same "?" meanwhile does nothing.
  const registering = useRef(new Set<string>());
  /**
   * "Log it" (true) or "Skip" (false) on a "?", from anywhere: its row's Yes, its question, its sheet (Codex r7 on
   * #610). The one entry point, so none can go ahead of a correction still queued for its place or trip: a "?" about
   * one is first registered with `waitForItemCorrections`, which says whether it waits for those corrections (its
   * waiting record, `afterCorrections`) or may be held at once. `afterCorrections` given: already registered (the
   * sheet's own changes). Whether it was taken now; a gated one is taken once its registration answers.
   */
  const answer = useCallback((itemId: string, logged: boolean, venue?: ReviewAnswerVenue | null,
    options: { afterCorrections?: string } = {}): boolean => {
    if (options.afterCorrections) {
      const recordOwner = accountOf(shownRef.current);
      return recordOwner
        ? startWaitingAnswer(itemId, logged, options.afterCorrections, ownerRef.current, recordOwner, currentMobileAccountEpoch()) === "started" : false;
    }
    const data = shownRef.current;
    const listed = data?.reviewItems?.find((candidate) => candidate.id === itemId);
    const segmentId = typeof listed?.rawPayload?.clientSegmentId === "string" ? listed.rawPayload.clientSegmentId : null;
    if (!data?.user?.id || !data.workspace?.id || !listed || !segmentId || !ownerRef.current) return holdAnswer(itemId, logged, venue);
    // The answer set as tapped (its proposal, an outing's members and theirs): held against it, never against what a
    // refresh brings meanwhile (Codex r8 and r9 on #610).
    const expected = answerSetOf(listed);
    if (registering.current.has(itemId)) return false;
    // Not answerable here now (no complete window, a waiting or rejected change of its own, already answered): refused
    // at once, never taken and dropped later (Codex r16 on #610).
    if (!canAnswer(itemId)) return false;
    registering.current.add(itemId);
    const owner = ownerRef.current;
    // The account lifetime it was asked in: an account change since, even back to this one, makes it stale (r16).
    const generation = currentMobileAccountEpoch();
    const id = createReviewClientMutationId();
    // An outing waits for its trips' queued corrections too, and its record answers them with it (Codex r10 on #610).
    const memberIds = [...expected.members.keys()];
    const memberItemIds = memberIds.flatMap((memberId) => {
      const member = data.reviewItems.find((candidate) => candidate.id === memberId);
      return typeof member?.rawPayload?.clientSegmentId === "string" ? [member.rawPayload.clientSegmentId] : [];
    });
    void waitForItemCorrections({ userId: data.user.id, workspaceId: data.workspace.id }, { id, itemId: segmentId, newIds: [],
      ...(memberItemIds.length ? { memberItemIds } : {}),
      action: { kind: "answer", reviewItemId: itemId, logged, ...(memberIds.length ? { outingMemberIds: memberIds } : {}) } }).then((record) => {
      registering.current.delete(itemId);
      if (!record) {
        if (ownerRef.current === owner && generation === currentMobileAccountEpoch()) holdAnswer(itemId, logged, venue, { expected });
        return;
      }
      // Waiting for a correction: no Apple place with it (the correction says where it was). The one completion path
      // (Codex r14 on #610): withdrawn, settled quietly, or held for Undo — never left held.
      startWaitingAnswer(itemId, logged, id, owner, { userId: data.user.id, workspaceId: data.workspace.id }, generation,
        { expected, outing: memberIds.length > 0 });
    }, () => {
      registering.current.delete(itemId);
      sayFor(owner, false, () => Alert.alert("Calendar", "Couldn’t save this answer on this iPhone."));
    });
    return true;
  }, [holdAnswer]);
  const undo = useCallback(() => {
    const current = hold.current();
    if (!current) return;
    const undone = hold.undo(current.token);
    if (!undone || undone.kind !== "single") return;
    const answer = undone as HeldAnswer;
    // Undo takes back the answer only: the sheet's corrections stay (Codex r2 on #610).
    if (answer.afterCorrections && answer.recordOwner) void withdrawAnswerAfterCorrections(answer.recordOwner, answer.afterCorrections);
    // An answer whose suggestion a refresh paged out while held comes back whole (outing included).
    restore(answer.owner, [answer.itemId, ...(answer.outing?.members.map((member) => member.itemId) ?? [])]);
    sayFor(answer.owner, false, () => AccessibilityInfo.announceForAccessibility(`${answer.title} is back.`));
    // The refs hold the latest data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);

  /**
   * A waiting answer dropped because its sheet's change was refused (Codex r3 on #610): its "?" comes back at once
   * (List, Grid and counts), from its remembered copy if a refresh paged it out.
   */
  const restoreAnswered = useCallback((itemIds: readonly string[]) => {
    const owner = ownerRef.current;
    // Still in its Undo window: that hold ends here, so its end can't hide the "?" again (Codex r4 on #610).
    const current = hold.current();
    if (current?.kind === "single" && (current as HeldAnswer).afterCorrections && itemIds.includes((current as HeldAnswer).itemId)) {
      hold.undo(current.token);
    }
    setSaving((now) => now && now.owner === owner
      ? { ...now, ids: new Set([...now.ids].filter((id) => !itemIds.includes(id))), awaiting: new Set([...now.awaiting].filter((id) => !itemIds.includes(id))) }
      : now);
    restore(owner, itemIds);
    // The refs hold the latest data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);

  const shownHeld = held && held.owner === ownerKey ? held : null;
  /** Every suggestion out of the List for now: the held answer's, and those saving or not yet handed over. */
  const hiddenIds = useMemo(() => new Set<string>([
    ...(saving && saving.owner === ownerKey ? saving.ids : []),
    ...(shownHeld ? [shownHeld.itemId, ...(shownHeld.outing?.members.map((member) => member.itemId) ?? [])] : [])
  ]), [ownerKey, saving, shownHeld]);

  /**
   * The "?" answered yes here and not yet handed over to the outbox's own record (held for Undo, or saving): a block
   * that ran into a trip shows ended at the trip's start meanwhile (location v4 design §7). Undo takes it out.
   */
  const answeredYesIds = useMemo(() => new Set([...hiddenIds].filter((id) => answeredLogged.current.get(id) === true)), [hiddenIds]);

  /** An edited sheet's answer, registered for `registeredFor` (`recordOwner`), started through the one completion path. */
  const startAfterCorrections = useCallback((itemId: string, logged: boolean, recordId: string, registeredFor: string | null,
    recordOwner: MobileAccountOwner, generation: number) =>
    startWaitingAnswerRef.current(itemId, logged, recordId, registeredFor, recordOwner, generation), []);
  /**
   * Whether a "?" can be answered here now (Codex r16 on #610): listed and open, a complete window, no waiting or
   * rejected change of its own, not already answered (held or saving) or being saved on the deck. An answer to one that
   * can't is refused at once, never accepted and dropped later.
   */
  const canAnswerNow = useCallback((itemId: string) => canAnswerRef.current(itemId), []);
  return { answer, answeredYesIds, canAnswer: canAnswerNow, data: shown, held: shownHeld, hiddenIds, restoreAnswered, startAfterCorrections, undo };
}
