import { useCallback, useEffect, useRef, useState } from "react";
import { Share } from "react-native";
import { runningMapKitChecks, startMapKitChecks, type MapKitCheckOutcome } from "./mapKitProbe";

/** Runs whose result was already shared, so one run is offered once, whichever screen shows it. */
const sharedRuns = new Set<number>();

export function mapKitCheckNote(outcome: Exclude<MapKitCheckOutcome, { status: "ready" }>) {
  return outcome.status === "needs_location"
    ? "Allow Location for Dayframe in iPhone Settings, then try again."
    : outcome.status === "no_position"
      ? "Your iPhone couldn't find where you are just now. Try again in a moment."
      : "Apple Maps couldn't be checked on this iPhone.";
}

type Options = {
  /** Also said in Sync help's Status line. */
  onNote?: (note: string) => void;
  share?: (message: string) => Promise<unknown>;
};

/**
 * Sync help's "Check Apple Maps nearby data" row. The run itself is single-flight for the app
 * (`startMapKitChecks`): a second tap, or Settings left and opened again, joins it. Only a screen
 * that is still showing presents the result; a screen the person left presents nothing.
 */
export function useMapKitChecks({ onNote, share }: Options = {}) {
  const [checking, setChecking] = useState(() => runningMapKitChecks() !== null);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(false);
  const following = useRef<number | null>(null);
  const callbacks = useRef({ onNote, share });
  callbacks.current = { onNote, share };

  const follow = useCallback(async (run: { id: number; result: Promise<MapKitCheckOutcome> }) => {
    if (following.current === run.id) return;
    following.current = run.id;
    setChecking(true);
    setNote(null);
    callbacks.current.onNote?.("Checking Apple Maps here… this takes about a minute.");
    const outcome = await run.result;
    if (!mounted.current || following.current !== run.id) return;
    following.current = null;
    setChecking(false);
    if (outcome.status !== "ready") {
      const message = mapKitCheckNote(outcome);
      setNote(message);
      callbacks.current.onNote?.(message);
      return;
    }
    if (sharedRuns.has(run.id)) return;
    sharedRuns.add(run.id);
    const present = callbacks.current.share ?? ((message: string) => Share.share({ title: "Dayframe Apple Maps checks", message }));
    await present(outcome.message).catch(() => undefined);
    if (!mounted.current) return;
    setNote("Finished · run it again at another place");
    callbacks.current.onNote?.("Apple Maps checks finished.");
  }, []);

  useEffect(() => {
    mounted.current = true;
    const run = runningMapKitChecks();
    if (run) void follow(run);
    return () => {
      mounted.current = false;
      following.current = null;
    };
  }, [follow]);

  const start = useCallback(() => {
    void follow(startMapKitChecks());
  }, [follow]);

  return { checking, note, start };
}
