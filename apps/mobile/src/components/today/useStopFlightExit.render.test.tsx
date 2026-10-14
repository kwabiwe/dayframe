import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const { useStopFlightExit } = await import("./useStopFlightExit");

type Props = { displayedEntryId: string | null; flightEntryId: string | null; hasLiveActiveTimer: boolean };
type Frame = { displayed: boolean; liveHidden: boolean; showIdle: boolean };

/** Records what the Today surface is told on every commit, as the Dashboard passes it on. */
function harness(initial: Props) {
  const frames: Frame[] = [];
  function Probe(props: Props) {
    const state = useStopFlightExit(props);
    frames.push({ ...state, displayed: Boolean(props.displayedEntryId) });
    return null;
  }
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Probe {...initial} />);
  });
  return {
    frames,
    set(props: Props) {
      const from = frames.length;
      act(() => renderer.update(<Probe {...props} />));
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
