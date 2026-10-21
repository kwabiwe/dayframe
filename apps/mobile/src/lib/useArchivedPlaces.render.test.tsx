import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  list: vi.fn(),
  restore: vi.fn(),
  owner: { userId: "user-a", workspaceId: "ws-1" } as { userId: string; workspaceId: string } | null,
  epoch: 1
}));
vi.mock("react-native", () => ({ AccessibilityInfo: { announceForAccessibility: (message: string) => mocks.announce(message) } }));
vi.mock("./api", () => {
  class AuthRequiredError extends Error {}
  return {
    AuthRequiredError,
    fetchArchivedPlaces: () => mocks.list(),
    setPlaceArchived: (id: string, archived: boolean) => mocks.restore(id, archived)
  };
});
vi.mock("./friendlyError", () => ({ friendlyMobileErrorMessage: (_error: unknown, fallback: string) => fallback }));
vi.mock("./mobileAccount", () => ({
  currentMobileAccountEpoch: () => mocks.epoch,
  mobileAccountKey: (owner: { userId: string; workspaceId: string }) => `${owner.workspaceId}:${owner.userId}`,
  readActiveMobileAccount: async () => mocks.owner
}));

const { useArchivedPlaces } = await import("./useArchivedPlaces");
type Hook = ReturnType<typeof useArchivedPlaces>;
type Refresh = Parameters<typeof useArchivedPlaces>[0]["refreshAfterRestore"];

const ACCOUNT_A = "ws-1:user-a";
const gym = { id: "30000000-0000-4000-8000-000000000009", name: "Example Gym", archivedAt: "2026-10-20T09:00:00.000Z" };
const studio = { id: "30000000-0000-4000-8000-000000000008", name: "Example Studio", archivedAt: "2026-10-19T09:00:00.000Z" };

let latest!: Hook;
let tree: ReturnType<typeof create> | undefined;
function Harness({ account, refresh }: { account: string | null; refresh: Refresh }) {
  latest = useArchivedPlaces({ onSignedOut: () => undefined, refreshAfterRestore: refresh, shownAccountKey: account });
  return null;
}

async function mount(refresh: Refresh, account: string | null = ACCOUNT_A) {
  await act(async () => { tree = create(<Harness account={account} refresh={refresh} />); });
  await act(async () => { await latest.load(); });
}

/** A refresh that settles with `outcome`, as the page's refreshAfterPlaceChange does. */
const settlingWith = (outcome: "applied" | "stale" | "failed"): Refresh => async (_place, settle) => { settle(outcome); };
/** A refresh that settles only when the test says so, recording whether the page may go on. */
function heldRefresh() {
  const held: { settle?: (outcome: "applied" | "stale" | "failed") => boolean; done?: () => void } = {};
  const refresh: Refresh = (_place, settle) => new Promise<void>((resolve) => { held.settle = settle; held.done = resolve; });
  return { held, refresh };
}

beforeEach(() => {
  mocks.owner = { userId: "user-a", workspaceId: "ws-1" };
  mocks.epoch = 1;
  mocks.list.mockResolvedValue([gym, studio]);
});
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  mocks.announce.mockReset();
  mocks.list.mockReset();
  mocks.restore.mockReset();
});

describe("useArchivedPlaces (location v3 PR 15b, PRD D19 A10)", () => {
  it("restores a place: it leaves Archived as the refreshed list applies, and is announced", async () => {
    mocks.restore.mockResolvedValue({ ...gym, archivedAt: null });
    await mount(settlingWith("applied"));
    expect(latest.places.map((place) => place.id)).toEqual([gym.id, studio.id]);
    mocks.list.mockResolvedValue([studio]);
    await act(async () => { await latest.restore(gym); });
    expect(mocks.restore).toHaveBeenCalledWith(gym.id, false);
    expect(latest.places.map((place) => place.id)).toEqual([studio.id]);
    expect(latest.pendingRestored).toEqual([]);
    expect(latest.restoringId).toBeNull();
    expect(mocks.announce).toHaveBeenCalledWith("Example Gym restored.");
  });

  it("keeps an accepted restore whose refresh failed as waiting under Saved places, and says so (Codex r1 on #508)", async () => {
    mocks.restore.mockResolvedValue({ ...gym, archivedAt: null });
    await mount(settlingWith("failed"));
    mocks.list.mockResolvedValue([studio]);
    await act(async () => { await latest.restore(gym); });
    // Out of Archived, but never in neither list: it waits as restored until a list lands.
    expect(latest.places.map((place) => place.id)).toEqual([studio.id]);
    expect(latest.pendingRestored).toEqual([{ id: gym.id, name: "Example Gym" }]);
    expect(mocks.announce).toHaveBeenCalledWith(expect.stringContaining("Example Gym is restored, but Places couldn't refresh"));
    // Another account's fresh list settles nothing; this account's does, once, so monitoring refreshes.
    expect(latest.takePendingRestored("ws-1:user-b")).toBe(false);
    let settled = false;
    act(() => { settled = latest.takePendingRestored(ACCOUNT_A); });
    expect(settled).toBe(true);
    expect(latest.pendingRestored).toEqual([]);
    expect(latest.takePendingRestored(ACCOUNT_A)).toBe(false);
  });

  it("keeps a refused restore's row with an announced reason", async () => {
    mocks.restore.mockRejectedValue(new Error("offline"));
    await mount(settlingWith("applied"));
    await act(async () => { await latest.restore(gym); });
    expect(latest.places.map((place) => place.id)).toEqual([gym.id, studio.id]);
    expect(latest.problem).toBe("Couldn't restore Example Gym. Try again.");
    expect(latest.restoringId).toBeNull();
    expect(mocks.announce).toHaveBeenCalledWith("Couldn't restore Example Gym. Try again.");
  });

  it("says nothing and shows nothing for a refusal that lands after the account changed (Codex r1 on #508)", async () => {
    let refuse!: (error: Error) => void;
    mocks.restore.mockReturnValue(new Promise((_resolve, reject) => { refuse = reject; }));
    await mount(settlingWith("applied"));
    let restoring!: Promise<void>;
    await act(async () => { restoring = latest.restore(gym); });
    expect(latest.restoringId).toBe(gym.id);
    // Signed out and into another account while the request was out.
    mocks.owner = { userId: "user-b", workspaceId: "ws-1" };
    mocks.epoch = 2;
    act(() => { tree!.update(<Harness account="ws-1:user-b" refresh={settlingWith("applied")} />); });
    await act(async () => { refuse(new Error("offline")); await restoring; });
    expect(latest.problem).toBeNull();
    expect(latest.restoringId).toBeNull();
    expect(latest.places).toEqual([]);
    expect(mocks.announce).not.toHaveBeenCalled();
  });

  it("ignores an answer from an earlier lifetime of the same account (switched away and back)", async () => {
    let refuse!: (error: Error) => void;
    mocks.restore.mockReturnValue(new Promise((_resolve, reject) => { refuse = reject; }));
    await mount(settlingWith("applied"));
    let restoring!: Promise<void>;
    await act(async () => { restoring = latest.restore(gym); });
    mocks.epoch = 3;
    await act(async () => { refuse(new Error("offline")); await restoring; });
    expect(latest.problem).toBeNull();
    expect(mocks.announce).not.toHaveBeenCalled();
  });

  it("refuses a settlement from an earlier account lifetime before anything changes (Codex r2 on #508)", async () => {
    mocks.restore.mockResolvedValue({ ...gym, archivedAt: null });
    const { held, refresh } = heldRefresh();
    await mount(refresh);
    let restoring!: Promise<void>;
    await act(async () => { restoring = latest.restore(gym); });
    expect(held.settle).toBeDefined();
    // Away and back: the same account key, a new lifetime.
    mocks.epoch = 2;
    let allowed = true;
    act(() => { allowed = held.settle!("failed"); });
    await act(async () => { held.done!(); await restoring; });
    expect(allowed).toBe(false);
    expect(latest.pendingRestored).toEqual([]);
    expect(latest.places.map((place) => place.id)).toEqual([gym.id, studio.id]);
    expect(latest.restoringId).toBeNull();
    expect(mocks.announce).not.toHaveBeenCalled();
  });

  it("sends one restore for two taps in the same frame, and only that request unlocks Restore (Codex r1 on #508)", async () => {
    let accept!: () => void;
    mocks.restore.mockReturnValueOnce(new Promise((resolve) => { accept = () => resolve({ ...gym, archivedAt: null }); }));
    await mount(settlingWith("applied"));
    let first!: Promise<void>;
    let second!: Promise<void>;
    // Both taps before React commits the busy state.
    await act(async () => {
      first = latest.restore(gym);
      second = latest.restore(studio);
      await second;
    });
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(latest.restoringId).toBe(gym.id);
    // The refused tap finishing never unlocks Restore for a third tap while the first is still out.
    await act(async () => { await latest.restore(studio); });
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    await act(async () => { accept(); await first; });
    expect(latest.restoringId).toBeNull();
    mocks.restore.mockResolvedValueOnce({ ...studio, archivedAt: null });
    await act(async () => { await latest.restore(studio); });
    expect(mocks.restore).toHaveBeenCalledTimes(2);
  });

  it("never breaks on a failed read, and shows another account's list to nobody", async () => {
    mocks.list.mockRejectedValue(new Error("offline"));
    await mount(settlingWith("applied"));
    expect(latest.places).toEqual([]);
    mocks.list.mockResolvedValue([gym]);
    await act(async () => { await latest.load(); });
    act(() => { tree!.update(<Harness account="ws-1:user-b" refresh={settlingWith("applied")} />); });
    expect(latest.places).toEqual([]);
  });
});
