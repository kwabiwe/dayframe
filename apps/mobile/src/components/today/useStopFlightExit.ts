import { useEffect, useState } from "react";

/**
 * Who shows the live block's exit after a Today Stop (motion.md: one animation owner per transition).
 *
 * The Stop flight's ghost owns the exit of the block it flew from. The Dashboard keeps the stopped entry
 * for a moment after Stop (`presentedActiveEntry`, for the entry sheet's own exit), and a ghost that fades
 * where it is (no row to land on) finishes before that: the live block then came back reading the next
 * second and ran its own exit, a flicker over the idle card (owner clip, TestFlight 120 code, 14 Oct).
 * So the flown entry stays owned by the flight until the Dashboard lets it go, unless Stop is rolled back
 * and the block is live again.
 */
export function useStopFlightExit({
  displayedEntryId,
  flightEntryId,
  hasLiveActiveTimer,
}: {
  /** The entry the Today surface would show (running, or retained just after Stop). */
  displayedEntryId: string | null;
  /** The entry a Stop flight is holding or flying, if any. */
  flightEntryId: string | null;
  hasLiveActiveTimer: boolean;
}) {
  const [flownEntryId, setFlownEntryId] = useState<string | null>(null);
  const flightHolds = Boolean(displayedEntryId && flightEntryId === displayedEntryId);

  // Remember the entry once its flight is under way, so it outlives the ghost.
  useEffect(() => {
    if (flightHolds && !hasLiveActiveTimer && flightEntryId !== flownEntryId) setFlownEntryId(flightEntryId);
  }, [flightEntryId, flightHolds, flownEntryId, hasLiveActiveTimer]);
  // Let it go once the Dashboard shows another entry or none, or the block is live again (rolled back).
  useEffect(() => {
    if (flownEntryId && (displayedEntryId !== flownEntryId || hasLiveActiveTimer)) setFlownEntryId(null);
  }, [displayedEntryId, flownEntryId, hasLiveActiveTimer]);

  const flightOwnsExit = Boolean(
    displayedEntryId &&
      !hasLiveActiveTimer &&
      (flightHolds || flownEntryId === displayedEntryId)
  );
  return {
    /** The ghost holds the block's place: draw the live block hidden. */
    liveHidden: flightHolds,
    /** The flight owns this entry's exit: show the idle card, never the stopped block again. */
    showIdle: flightOwnsExit,
  };
}
