import { StrictMode, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const { useStopFlightExit } = await import("./useStopFlightExit");

type Props = {
  displayedEntryId: string | null;
  flightEntryId: string | null;
  hasLiveActiveTimer: boolean;
  resolveEntryId?: (entryId: string) => string;
};
type Frame = { displayed: boolean; liveHidden: boolean; showIdle: boolean };

/** Records what the Today surface is told on every commit (StrictMode, as in the app's dev builds). */
function harness(initial: Props) {
  const frames: Frame[] = [];
  function Probe(props: Props) {
    const state = useStopFlightExit(props);
    const frame = { ...state, displayed: Boolean(props.displayedEntryId) };
    useEffect(() => {
      frames.push(frame);
    });
    return null;
  }
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<StrictMode><Probe {...initial} /></StrictMode>);
  });
  return {
    frames,
    set(props: Props) {
      const from = frames.length;
      act(() => renderer.update(<StrictMode><Probe {...props} /></StrictMode>));
      return frames.slice(from);
    },
  };
}

/** The live block is drawn (visible) in this frame. */
const liveBlockShown = (frame: Frame) => frame.displayed && !frame.showIdle && !frame.liveHidden;

describe("useStopFlightExit", () => {
  it("never shows the stopped block again after a ghost that faded in place, while the Dashboard still retains it (owner clip 14 Oct)", () => {
    const running = { displayedEntryId: "entry-a", flightEntryId: null, hasLiveActiveTimer: true };
    const view = harness(running);
    expect(liveBlockShown(view.frames.at(-1)!)).toBe(true);

    // Stop pressed: the ghost holds the block's place.
    expect(view.set({ ...running, flightEntryId: "entry-a" }).every((frame) => frame.liveHidden)).toBe(true);
    // Stop accepted: no live timer, the entry is retained for the sheet's exit, the ghost flies.
    const accepted = view.set({ displayedEntryId: "entry-a", flightEntryId: "entry-a", hasLiveActiveTimer: false });
    expect(accepted.every((frame) => frame.showIdle)).toBe(true);
    // The ghost finishes (200 ms fade in place) before the Dashboard lets the entry go (about 300 ms).
    const ghostGone = view.set({ displayedEntryId: "entry-a", flightEntryId: null, hasLiveActiveTimer: false });
    expect(ghostGone.some(liveBlockShown)).toBe(false);
    expect(ghostGone.every((frame) => frame.showIdle)).toBe(true);
    // The Dashboard releases the entry: idle stays.
    const released = view.set({ displayedEntryId: null, flightEntryId: null, hasLiveActiveTimer: false });
    expect(released.some(liveBlockShown)).toBe(false);
  });

  it("keeps owning the exit when the stopped block's optimistic ID is reconciled to its canonical ID (Codex r1 on #415)", () => {
    const correlations = new Map<string, string>();
    const resolveEntryId = (id: string) => correlations.get(id) ?? id;
    const view = harness({ displayedEntryId: "optimistic:1", flightEntryId: null, hasLiveActiveTimer: true, resolveEntryId });
    view.set({ displayedEntryId: "optimistic:1", flightEntryId: "optimistic:1", hasLiveActiveTimer: true, resolveEntryId });
    // The Start is reconciled while the Stop is accepted: the Dashboard now shows the canonical ID.
    correlations.set("optimistic:1", "entry-c");
    const accepted = view.set({ displayedEntryId: "entry-c", flightEntryId: "optimistic:1", hasLiveActiveTimer: false, resolveEntryId });
    expect(accepted.some(liveBlockShown)).toBe(false);
    const ghostGone = view.set({ displayedEntryId: "entry-c", flightEntryId: null, hasLiveActiveTimer: false, resolveEntryId });
    expect(ghostGone.some(liveBlockShown)).toBe(false);
    // A rollback of the canonical block brings it back.
    const rolledBack = view.set({ displayedEntryId: "entry-c", flightEntryId: null, hasLiveActiveTimer: true, resolveEntryId });
    expect(liveBlockShown(rolledBack.at(-1)!)).toBe(true);
  });

  it("brings the live block back when Stop is rolled back", () => {
    const view = harness({ displayedEntryId: "entry-a", flightEntryId: "entry-a", hasLiveActiveTimer: false });
    // Delivery rejected: the block is live again and the ghost leaves without landing.
    view.set({ displayedEntryId: "entry-a", flightEntryId: null, hasLiveActiveTimer: true });
    expect(liveBlockShown(view.frames.at(-1)!)).toBe(true);
  });

  it("shows a new block started right after the Stop", () => {
    const view = harness({ displayedEntryId: "entry-a", flightEntryId: "entry-a", hasLiveActiveTimer: false });
    view.set({ displayedEntryId: "entry-a", flightEntryId: null, hasLiveActiveTimer: false });
    view.set({ displayedEntryId: "entry-b", flightEntryId: null, hasLiveActiveTimer: true });
    expect(liveBlockShown(view.frames.at(-1)!)).toBe(true);
  });

  it("leaves a Stop without a flight (Reduce Motion) to the surface's own exit", () => {
    const view = harness({ displayedEntryId: "entry-a", flightEntryId: null, hasLiveActiveTimer: true });
    const stopped = view.set({ displayedEntryId: "entry-a", flightEntryId: null, hasLiveActiveTimer: false });
    expect(stopped.every((frame) => !frame.showIdle && !frame.liveHidden)).toBe(true);
  });
});
