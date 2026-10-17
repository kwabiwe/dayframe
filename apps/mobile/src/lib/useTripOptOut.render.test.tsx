import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const mocks = vi.hoisted(() => ({ announce: vi.fn(), stop: vi.fn(), epoch: 1 }));
vi.mock("react-native", () => ({ AccessibilityInfo: { announceForAccessibility: (message: string) => mocks.announce(message) } }));
vi.mock("./api", () => ({ stopLoggingTripsLike: (eventId: string) => mocks.stop(eventId) }));
vi.mock("./mobileAccount", () => ({ currentMobileAccountEpoch: () => mocks.epoch }));

const { TRIP_OPT_OUT_DONE, TRIP_OPT_OUT_FAILED, useTripOptOut } = await import("./useTripOptOut");

type Result = ReturnType<typeof useTripOptOut>;
let latest: Result = null;
function Harness({ eventId, token }: { eventId: string | null; token: number }) {
  latest = useTripOptOut(eventId, token);
  return null;
}

afterEach(() => {
  mocks.announce.mockReset();
  mocks.stop.mockReset();
  latest = null;
});

describe("useTripOptOut on iPhone (PRD D19, A4)", () => {
  it("offers nothing for a block that is not an automatic Move", () => {
    act(() => { create(<Harness eventId={null} token={1} />); });
    expect(latest).toBeNull();
  });

  it("stops the trip from its Move's event, says so and announces it; a newer toast starts fresh", async () => {
    mocks.stop.mockResolvedValue(undefined);
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<Harness eventId="event-1" token={1} />); });
    await act(async () => { latest!.onAction(); });
    expect(mocks.stop).toHaveBeenCalledWith("event-1");
    expect(latest).toMatchObject({ busy: false, done: TRIP_OPT_OUT_DONE });
    expect(mocks.announce).toHaveBeenCalledWith(TRIP_OPT_OUT_DONE);
    act(() => { tree.update(<Harness eventId="event-2" token={2} />); });
    expect(latest).toMatchObject({ busy: false, done: null });
  });

  it("says when it could not save", async () => {
    mocks.stop.mockRejectedValue(new TypeError("Network request failed"));
    act(() => { create(<Harness eventId="event-1" token={1} />); });
    await act(async () => { latest!.onAction(); });
    expect(latest?.done).toBe(TRIP_OPT_OUT_FAILED);
  });

  it("neither shows nor announces an answer for a toast that is gone, or for another account (Codex r1 on #464)", async () => {
    let finish!: () => void;
    mocks.stop.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<Harness eventId="event-1" token={1} />); });
    act(() => { latest!.onAction(); });
    // Undo or expiry: no active deletion.
    act(() => { tree.update(<Harness eventId={null} token={1} />); });
    await act(async () => { finish(); });
    expect(mocks.announce).not.toHaveBeenCalled();
    // Another account restarts deletion tokens at 1: the same token is a different toast.
    mocks.epoch += 1;
    act(() => { tree.update(<Harness eventId="event-9" token={1} />); });
    expect(latest).toMatchObject({ busy: false, done: null });
  });
});
