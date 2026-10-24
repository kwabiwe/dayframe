import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Alert, AppState } from "react-native";
import { outingKeyOf } from "@dayframe/shared";
import type { MobileBootstrap, MobileReviewItem } from "../../lib/api";
import { friendlyMobileErrorMessage } from "../../lib/friendlyError";
import { hasSuggestedTimeWindow, isLocationReviewItem, isOpenReviewItem } from "../../lib/review";
import { reviewAnswerMutation } from "../../lib/reviewAnswer";
import { claimReviewAnswer, isReviewAnswerClaimed, releaseReviewAnswer } from "../../lib/reviewAnswerClaims";
import { createReviewDeckHold, reviewDeckProposalSignature, type ReviewDeckHeld, type ReviewDeckHeldDecision } from "../../lib/reviewDeckHold";
import { heldOutingStillSame, reviewDeckOutings } from "../../lib/reviewDeckOutings";
import { createReviewClientMutationId, enqueueReviewMutation, synchroniseReviewMutations } from "../../lib/reviewSyncStore";

/** A held answer, with the account that gave it. */
type HeldAnswer = ReviewDeckHeldDecision & { owner: string | null };
/** Answers saving or saved whose hand-over to the outbox's own record is pending, for one account. */
type Saving = { owner: string | null; ids: ReadonlySet<string>; awaiting: ReadonlySet<string> };

/**
 * Answers to Calendar › List's "?" (location v4 step 14, iPhone part 3b): the deck's "Log it" and "Skip",
 * with its Undo. An answer is held for the deck's Undo window (`createReviewDeckHold`, 4.8 s) and only then
 * saved, with the one rule both use (`reviewAnswerMutation`), so it is the deck's mutation exactly.
 *
 * As the deck does: a suggestion that changed (`reviewDeckProposalSignature`), whose outing changed
 * (`heldOutingStillSame`) or that was decided elsewhere while held is not saved; one a capped refresh only
 * left out of the loaded list is saved from the copy the List showed; and nothing the deck is already saving
 * is saved again (`reviewAnswerClaims`). Everything belongs to the account that answered: switching account
 * drops a held answer unsaved and silences any late result. While held or saving, its "?" (and an outing's
 * folded trips) leave the List; once saved, it hands over to the outbox's own record at its next read
 * (shown again if that record does not hide it, a rejected answer restored). Backgrounding the app saves a
 * held answer at once, as in Review; so does the Dashboard going away.
 */
export function useCalendarCheckAnswers({ data, locallyDecidedIds, ownerKey }: {
  /** The Calendar's bootstrap (its Review items included): what an answer is checked against and saved with. */
  data: MobileBootstrap | null;
  /** Suggestions already decided on this phone (the outbox's own record, read again on every Review sync). */
  locallyDecidedIds: ReadonlySet<string>;
  /** The signed-in account's scope: holds and saves belong to it. */
  ownerKey: string | null;
}) {
  const dataRef = useRef(data);
  const ownerRef = useRef(ownerKey);
  const decidedRef = useRef(locallyDecidedIds);
  const [held, setHeld] = useState<HeldAnswer | null>(null);
  const [saving, setSaving] = useState<Saving | null>(null);
  // The copy each held answer was made from, for an item a capped refresh leaves out (cleared per account).
  const known = useRef(new Map<string, MobileReviewItem>());
  const token = useRef(0);

  const isOpen = (item: MobileReviewItem) => isOpenReviewItem(item) && !decidedRef.current.has(item.id);
  // The deck's own outing grouping and eligibility (a complete window, nothing of its own being saved).
  const outingMembersOf = (item: MobileReviewItem) => {
    const open = (dataRef.current?.reviewItems ?? []).filter((candidate) => isOpen(candidate));
    const { outings } = reviewDeckOutings(open, (candidate) => isLocationReviewItem(candidate) && hasSuggestedTimeWindow(candidate)
      && !isReviewAnswerClaimed(candidate.id));
    return outings.get(item.id)?.members ?? [];
  };
  // Listed and open, listed and decided (undefined), or left out of the list (the known copy).
  const resolveOpen = (itemId: string) => {
    const listed = dataRef.current?.reviewItems?.find((candidate) => candidate.id === itemId);
    if (listed) return isOpen(listed) ? listed : undefined;
    const copy = known.current.get(itemId);
    return copy && !decidedRef.current.has(itemId) ? copy : undefined;
  };

  const save = (decision: HeldAnswer) => {
    if (decision.owner !== ownerRef.current) return; // Another account now: never saved there.
    const item = resolveOpen(decision.itemId);
    if (!item) return; // Decided elsewhere while held: it has already left the List.
    const members = decision.outing
      ? heldOutingStillSame(decision.outing.members, outingKeyOf(item) === decision.outing.key ? decision.outing.key : null,
        resolveOpen, reviewDeckProposalSignature)
      : [];
    if (reviewDeckProposalSignature(item) !== decision.proposal || members === null) {
      AccessibilityInfo.announceForAccessibility(`${decision.title} changed, so it was not saved. Check it again.`);
      return;
    }
    const affected = [item, ...members];
    const ids = affected.map((candidate) => candidate.id);
    const bootstrap = dataRef.current;
    if (!bootstrap || !claimReviewAnswer(ids)) return;
    const owner = decision.owner;
    const loaded = new Set(bootstrap.reviewItems.map((candidate) => candidate.id));
    const unlisted = affected.filter((candidate) => !loaded.has(candidate.id));
    // Saved from the copy the List showed when a capped refresh only paged it out (as the deck does).
    const current = unlisted.length ? { ...bootstrap, reviewItems: [...bootstrap.reviewItems, ...unlisted] } : bootstrap;
    setSaving((now) => now?.owner === owner
      ? { ...now, ids: new Set([...now.ids, ...ids]) }
      : { owner, ids: new Set(ids), awaiting: new Set() });
    const settle = (ok: boolean) => {
      releaseReviewAnswer(ids);
      if (ownerRef.current !== owner) return; // Late for another account: no word of it there.
      setSaving((now) => {
        if (!now || now.owner !== owner) return now;
        if (ok) return { ...now, awaiting: new Set([...now.awaiting, ...ids]) };
        return { ...now, ids: new Set([...now.ids].filter((id) => !ids.includes(id))) };
      });
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
  };
  const saveRef = useRef(save);
  // The latest values for the hold's later callbacks (never written during render).
  useLayoutEffect(() => {
    dataRef.current = data;
    decidedRef.current = locallyDecidedIds;
    saveRef.current = save;
  });

  const hold = useMemo(() => createReviewDeckHold({
    onChange: (current: ReviewDeckHeld | null) => setHeld(current?.kind === "single" ? current as HeldAnswer : null),
    onCommit: (current: ReviewDeckHeld) => {
      if (current.kind === "single") saveRef.current(current as HeldAnswer);
    }
  }), []);

  // Another account: a held answer is dropped unsaved, and nothing of the last account stays hidden.
  useLayoutEffect(() => {
    if (ownerRef.current === ownerKey) return;
    ownerRef.current = ownerKey;
    const current = hold.current();
    if (current) hold.undo(current.token);
    known.current.clear();
    setSaving(null);
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
    const listed = dataRef.current?.reviewItems?.find((candidate) => candidate.id === itemId);
    if (!listed || !isOpen(listed) || isReviewAnswerClaimed(itemId)) return;
    // Logging needs the suggestion's whole window, as on its deck card.
    if (logged && !hasSuggestedTimeWindow(listed)) return;
    const members = outingMembersOf(listed);
    const outingKey = members.length ? outingKeyOf(listed) : null;
    known.current.set(listed.id, listed);
    for (const member of members) known.current.set(member.id, member);
    token.current += 1;
    const decision: HeldAnswer = {
      kind: "single",
      token: token.current,
      key: listed.id,
      itemId: listed.id,
      logged,
      direction: logged ? 1 : -1,
      title: listed.title?.trim() || "Suggestion",
      color: "",
      seconds: 0,
      proposal: reviewDeckProposalSignature(listed),
      owner: ownerRef.current,
      ...(members.length && outingKey ? {
        outing: { key: outingKey, members: members.map((member) => ({ key: member.id, itemId: member.id, proposal: reviewDeckProposalSignature(member) })) }
      } : {})
    };
    hold.hold(decision);
    // The answers read the hook's refs, which hold the latest data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);
  const undo = useCallback(() => {
    const current = hold.current();
    if (current) hold.undo(current.token);
  }, [hold]);

  const shownHeld = held && held.owner === ownerKey ? held : null;
  /** Every suggestion out of the List for now: the held answer's, and those saving or not yet handed over. */
  const hiddenIds = useMemo(() => new Set<string>([
    ...(saving && saving.owner === ownerKey ? saving.ids : []),
    ...(shownHeld ? [shownHeld.itemId, ...(shownHeld.outing?.members.map((member) => member.itemId) ?? [])] : [])
  ]), [ownerKey, saving, shownHeld]);

  return { answer, held: shownHeld, hiddenIds, undo };
}
