import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Alert, AppState } from "react-native";
import type { MobileBootstrap, MobileReviewItem } from "../../lib/api";
import { friendlyMobileErrorMessage } from "../../lib/friendlyError";
import { hasSuggestedTimeWindow, isLocationReviewItem, isOpenReviewItem } from "../../lib/review";
import { reviewAnswerMutation } from "../../lib/reviewAnswer";
import { createReviewDeckHold, reviewDeckProposalSignature, type ReviewDeckHeld, type ReviewDeckHeldDecision } from "../../lib/reviewDeckHold";
import { reviewDeckOutings } from "../../lib/reviewDeckOutings";
import { createReviewClientMutationId, enqueueReviewMutation, synchroniseReviewMutations } from "../../lib/reviewSyncStore";

/**
 * Answers to Calendar › List's "?" (location v4 step 14, iPhone part 3b): the deck's "Log it" and "Skip",
 * with its Undo. An answer is held for the deck's Undo window (`createReviewDeckHold`, 4.8 s) and only then
 * saved, with the one rule both use (`reviewAnswerMutation`), so it is the deck's mutation exactly. While
 * held or saving, its "?" (and an outing's folded trips) leave the List at once; Undo brings them back. A
 * suggestion that changed or was decided elsewhere while held is not saved. Sending the app to the
 * background saves a held answer at once, as it does in Review; so does the Dashboard going away.
 */
export function useCalendarCheckAnswers({ data, locallyDecidedIds }: {
  /** The Calendar's bootstrap (its Review items included): what an answer is checked against and saved with. */
  data: MobileBootstrap | null;
  /** Suggestions already decided on this phone (the outbox's own record): a saved answer hands over to it. */
  locallyDecidedIds: ReadonlySet<string>;
}) {
  const dataRef = useRef(data);
  const [held, setHeld] = useState<ReviewDeckHeldDecision | null>(null);
  // Answers saved on this phone that the outbox's record does not show yet: still out of the List.
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  const inFlight = useRef(new Set<string>());
  const token = useRef(0);

  const openItem = (itemId: string) => {
    const item = dataRef.current?.reviewItems?.find((candidate) => candidate.id === itemId);
    return item && isOpenReviewItem(item) ? item : undefined;
  };
  const outingMembers = (item: MobileReviewItem) => {
    const open = (dataRef.current?.reviewItems ?? []).filter((candidate) => isOpenReviewItem(candidate));
    // The deck's own grouping, so an outing is decided with exactly the trips the deck would decide.
    const { outings } = reviewDeckOutings(open, (candidate) => isLocationReviewItem(candidate) && hasSuggestedTimeWindow(candidate));
    return outings.get(item.id)?.members ?? [];
  };

  const save = (decision: ReviewDeckHeldDecision) => {
    const item = openItem(decision.itemId);
    const memberIds = decision.outing?.members.map((member) => member.itemId) ?? [];
    if (!item) return; // Decided elsewhere while held: nothing to save, and it has already left.
    const members = memberIds.map(openItem);
    const changed = reviewDeckProposalSignature(item) !== decision.proposal
      || members.some((member, index) => !member || reviewDeckProposalSignature(member) !== decision.outing!.members[index].proposal);
    if (changed) {
      AccessibilityInfo.announceForAccessibility(`${decision.title} changed, so it was not saved. Check it again.`);
      return;
    }
    const affected = [item, ...(members as MobileReviewItem[])];
    if (affected.some((candidate) => inFlight.current.has(candidate.id))) return;
    const bootstrap = dataRef.current;
    if (!bootstrap) return;
    for (const candidate of affected) inFlight.current.add(candidate.id);
    setSaving((current) => new Set([...current, ...affected.map((candidate) => candidate.id)]));
    const release = () => {
      for (const candidate of affected) inFlight.current.delete(candidate.id);
    };
    void enqueueReviewMutation({
      bootstrap,
      item,
      mutation: reviewAnswerMutation(item, decision.logged, { outingMemberIds: memberIds.length ? memberIds : undefined }),
      clientMutationId: createReviewClientMutationId(),
      ...(memberIds.length ? { affectedItems: affected } : {})
    }).then(() => {
      release();
      AccessibilityInfo.announceForAccessibility(`${decision.logged ? "Logged" : "Skipped"}. Saved on this iPhone. Waiting to sync.`);
      void synchroniseReviewMutations().catch(() => undefined);
    }).catch((error) => {
      release();
      setSaving((current) => {
        const next = new Set(current);
        for (const candidate of affected) next.delete(candidate.id);
        return next;
      });
      AccessibilityInfo.announceForAccessibility("The answer wasn’t saved. It is still here to check.");
      Alert.alert("Calendar", friendlyMobileErrorMessage(error, "Couldn’t save this answer on this iPhone."));
    });
  };
  const saveRef = useRef(save);
  // The latest data and save for the hold's later callbacks (never written during render).
  useLayoutEffect(() => {
    dataRef.current = data;
    saveRef.current = save;
  });

  const hold = useMemo(() => createReviewDeckHold({
    onChange: (current: ReviewDeckHeld | null) => setHeld(current?.kind === "single" ? current : null),
    onCommit: (current: ReviewDeckHeld) => {
      if (current.kind === "single") saveRef.current(current);
    }
  }), []);

  // A saved answer hands over to the outbox's own record once that shows it.
  useEffect(() => {
    if (![...saving].some((id) => locallyDecidedIds.has(id))) return;
    setSaving((current) => new Set([...current].filter((id) => !locallyDecidedIds.has(id))));
  }, [locallyDecidedIds, saving]);
  // Backgrounding saves a held answer now; so does leaving (unmount), as leaving Review does.
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
    const item = openItem(itemId);
    if (!item || inFlight.current.has(itemId)) return;
    const members = outingMembers(item);
    token.current += 1;
    hold.hold({
      kind: "single",
      token: token.current,
      key: item.id,
      itemId: item.id,
      logged,
      direction: logged ? 1 : -1,
      title: item.title?.trim() || "Suggestion",
      color: "",
      seconds: 0,
      proposal: reviewDeckProposalSignature(item),
      ...(members.length ? {
        outing: { key: item.id, members: members.map((member) => ({ key: member.id, itemId: member.id, proposal: reviewDeckProposalSignature(member) })) }
      } : {})
    });
    // The answers hand over immediately: data reads are in the hook's refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);
  const undo = useCallback(() => {
    const current = hold.current();
    if (current) hold.undo(current.token);
  }, [hold]);

  /** Every suggestion out of the List for now: the held answer's, and those saving. */
  const hiddenIds = useMemo(() => new Set<string>([
    ...saving,
    ...(held ? [held.itemId, ...(held.outing?.members.map((member) => member.itemId) ?? [])] : [])
  ]), [held, saving]);

  return { answer, held, hiddenIds, undo };
}
