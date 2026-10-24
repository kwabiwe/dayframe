import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Alert, AppState } from "react-native";
import { outingKeyOf } from "@dayframe/shared";
import type { MobileBootstrap, MobileReviewItem } from "../../lib/api";
import { friendlyMobileErrorMessage } from "../../lib/friendlyError";
import { hasSuggestedTimeWindow, isLocationReviewItem, isOpenReviewItem } from "../../lib/review";
import { reviewAnswerMutation } from "../../lib/reviewAnswer";
import { claimReviewAnswer, isReviewAnswerClaimed, releaseReviewAnswer, rememberedReviewAnswerStillOpen } from "../../lib/reviewAnswerClaims";
import { createReviewDeckHold, reviewDeckProposalSignature, type ReviewDeckHeld, type ReviewDeckHeldDecision } from "../../lib/reviewDeckHold";
import { heldOutingStillSame, reviewDeckOutings } from "../../lib/reviewDeckOutings";
import { createReviewClientMutationId, enqueueReviewMutation, synchroniseReviewMutations } from "../../lib/reviewSyncStore";

/** A held answer, with the account that gave it. */
type HeldAnswer = ReviewDeckHeldDecision & { owner: string | null };
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
 * Answers to Calendar › List's "?" (location v4 step 14, iPhone part 3b): the deck's "Log it" and "Skip",
 * with its Undo. An answer is held for the deck's Undo window (`createReviewDeckHold`, 4.8 s) and only then
 * saved, with the one rule both use (`reviewAnswerMutation`), so it is the deck's mutation exactly.
 *
 * As the deck does: a suggestion that changed (`reviewDeckProposalSignature`), whose outing changed
 * (`heldOutingStillSame`) or that was decided elsewhere while held is not saved; one a capped refresh only
 * left out of the loaded list is saved from the copy the List showed, once this phone is known not to have
 * decided it meanwhile (`rememberedReviewAnswerStillOpen`); nothing the deck is already saving is saved
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

  const isOpen = (item: MobileReviewItem) => isOpenReviewItem(item) && !decidedRef.current.has(item.id);
  // Listed (or brought back) and open, listed and decided (undefined), or left out of the list (the known copy).
  const resolveOpen = (itemId: string) => {
    const listed = shownRef.current?.reviewItems?.find((candidate) => candidate.id === itemId);
    if (listed) return isOpen(listed) ? listed : undefined;
    const copy = known.current.get(itemId);
    return copy && !decidedRef.current.has(itemId) ? copy : undefined;
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

  const save = (decision: HeldAnswer) => {
    if (decision.owner !== ownerRef.current) return; // Another account now: never saved there.
    const owner = decision.owner;
    const heldIds = [decision.itemId, ...(decision.outing?.members.map((member) => member.itemId) ?? [])];
    const item = resolveOpen(decision.itemId);
    if (!item) return; // Decided elsewhere while held: it has already left the List.
    const members = decision.outing
      ? heldOutingStillSame(decision.outing.members, outingKeyOf(item) === decision.outing.key ? decision.outing.key : null,
        resolveOpen, reviewDeckProposalSignature)
      : [];
    if (reviewDeckProposalSignature(item) !== decision.proposal || members === null) {
      restore(owner, heldIds);
      AccessibilityInfo.announceForAccessibility(`${decision.title} changed, so it was not saved. Check it again.`);
      return;
    }
    const affected = [item, ...members];
    const ids = affected.map((candidate) => candidate.id);
    const bootstrap = shownRef.current;
    const loadedData = dataRef.current;
    if (!bootstrap || !loadedData || ids.some((id) => isReviewAnswerClaimed(id))) return;
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
    const unhide = () => {
      if (ownerRef.current !== owner) return;
      setSaving((now) => now && now.owner === owner ? { ...now, ids: new Set([...now.ids].filter((id) => !ids.includes(id))) } : now);
    };
    void rememberedReviewAnswerStillOpen(current, remembered.map((candidate) => candidate.id)).catch(() => false).then((open) => {
      if (ownerRef.current !== owner) return;
      // Decided meanwhile on this phone (the deck), or being saved there now: not this answer's to save.
      if (!open || !claimReviewAnswer(ids)) {
        unhide();
        return;
      }
      const settle = (ok: boolean) => {
        releaseReviewAnswer(ids);
        if (ownerRef.current !== owner) return; // Late for another account: no word of it there.
        if (ok) setSaving((now) => now && now.owner === owner ? { ...now, awaiting: new Set([...now.awaiting, ...ids]) } : now);
        else {
          unhide();
          restore(owner, ids);
        }
      };
      void enqueueReviewMutation({
        bootstrap: current,
        item,
        mutation: reviewAnswerMutation(item, decision.logged, { outingMemberIds: members.length ? ids.slice(1) : undefined }),
        clientMutationId: createReviewClientMutationId(),
        ...(members.length ? { affectedItems: affected } : {})
      }).then(() => {
        settle(true);
        if (ownerRef.current !== owner) return;
        AccessibilityInfo.announceForAccessibility(`${decision.logged ? "Logged" : "Skipped"}. Saved on this iPhone. Waiting to sync.`);
        void synchroniseReviewMutations().catch(() => undefined);
      }).catch((error) => {
        settle(false);
        if (ownerRef.current !== owner) return;
        AccessibilityInfo.announceForAccessibility("The answer wasn’t saved. It is still here to check.");
        Alert.alert("Calendar", friendlyMobileErrorMessage(error, "Couldn’t save this answer on this iPhone."));
      });
    });
  };
  const saveRef = useRef(save);
  // The latest values for the hold's later callbacks (never written during render).
  useLayoutEffect(() => {
    dataRef.current = data;
    shownRef.current = shown;
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
    if (current) hold.undo(current.token);
    known.current.clear();
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
  // Backgrounding saves a held answer now; so does the Dashboard going away.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") hold.flush();
    });
    return () => {
      subscription.remove();
      hold.flush();
    };
  }, [hold]);

  /** "Log it" (true) or "Skip" (false) on a "?"; a new answer saves the one held before it. */
  const answer = useCallback((itemId: string, logged: boolean) => {
    const listed = shownRef.current?.reviewItems?.find((candidate) => candidate.id === itemId);
    if (!listed || !isOpen(listed) || isReviewAnswerClaimed(itemId)) return;
    // Logging needs the suggestion's whole window, as on its deck card.
    if (logged && !hasSuggestedTimeWindow(listed)) return;
    // The outing the List asks about (the one map it folds and counts with).
    const open = (shownRef.current?.reviewItems ?? []).filter((candidate) => isOpen(candidate));
    const members = calendarCheckOutings(open, syncStatesRef.current).outings.get(listed.id)?.members ?? [];
    // A trip of it already saving on the deck: that decision comes first, and the outing leaves the List with it.
    if (members.some((member) => isReviewAnswerClaimed(member.id))) return;
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
      proposal: reviewDeckProposalSignature(listed),
      owner: ownerRef.current,
      ...(members.length && outingKey ? {
        outing: { key: outingKey, members: members.map((member) => ({ key: member.id, itemId: member.id, proposal: reviewDeckProposalSignature(member) })) }
      } : {})
    };
    hold.hold(decision);
    // As the deck says it (Codex r2 on #582): the answer, and that Undo is there while its window runs.
    AccessibilityInfo.announceForAccessibility(`${logged ? "Logged" : "Skipped"} ${title}. Undo is available for a few seconds.`);
    // The answers read the hook's refs, which hold the latest data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);
  const undo = useCallback(() => {
    const current = hold.current();
    if (!current) return;
    const undone = hold.undo(current.token);
    if (!undone || undone.kind !== "single") return;
    const answer = undone as HeldAnswer;
    // An answer whose suggestion a refresh paged out while held comes back whole (outing included).
    restore(answer.owner, [answer.itemId, ...(answer.outing?.members.map((member) => member.itemId) ?? [])]);
    AccessibilityInfo.announceForAccessibility(`${answer.title} is back.`);
    // The refs hold the latest data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);

  const shownHeld = held && held.owner === ownerKey ? held : null;
  /** Every suggestion out of the List for now: the held answer's, and those saving or not yet handed over. */
  const hiddenIds = useMemo(() => new Set<string>([
    ...(saving && saving.owner === ownerKey ? saving.ids : []),
    ...(shownHeld ? [shownHeld.itemId, ...(shownHeld.outing?.members.map((member) => member.itemId) ?? [])] : [])
  ]), [ownerKey, saving, shownHeld]);

  return { answer, data: shown, held: shownHeld, hiddenIds, undo };
}
