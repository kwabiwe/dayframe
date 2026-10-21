import { act, create, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory render of the Places screen (app/places.tsx) for the Archived restore paths
// (location v3 PR 15b; Codex r2 on #508). Presentation is mocked; the screen, `useArchivedPlaces`
// and the `placesPage` helpers are real.
vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

type Owner = { userId: string; workspaceId: string };
const mocks = vi.hoisted(() => ({
  owner: null as Owner | null,
  epoch: 1,
  fetchBootstrap: vi.fn(),
  fetchArchivedPlaces: vi.fn(),
  setPlaceArchived: vi.fn(),
  refreshGeofences: vi.fn(),
  announce: vi.fn()
}));

const factories = vi.hoisted(() => ({
  accountMock: () => ({
    currentMobileAccountEpoch: () => mocks.epoch,
    mobileAccountKey: (owner: Owner) => `${owner.workspaceId}:${owner.userId}`,
    mobileAccountOwnersEqual: (left: Owner | null | undefined, right: Owner | null | undefined) =>
      left?.userId === right?.userId && left?.workspaceId === right?.workspaceId,
    readActiveMobileAccount: async () => mocks.owner
  }),
  apiMock: () => {
    class AuthRequiredError extends Error {}
    return {
      AuthRequiredError,
      fetchArchivedPlaces: () => mocks.fetchArchivedPlaces(),
      fetchBootstrap: () => mocks.fetchBootstrap(),
      forgetLearnedPlace: vi.fn(),
      ignoreLearnedPlace: vi.fn(),
      setPlaceArchived: (id: string, archived: boolean) => mocks.setPlaceArchived(id, archived),
      setPlaceRole: vi.fn()
    };
  },
  friendlyMock: () => ({ friendlyMobileErrorMessage: (_error: unknown, fallback: string) => fallback, mobileFailureKind: () => "other" })
}));

vi.mock("react-native", async () => {
  const React = await import("react");
  const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as never);
  return {
    AccessibilityInfo: { announceForAccessibility: (message: string) => mocks.announce(message) },
    Alert: { alert: vi.fn() },
    Modal: host("Modal"),
    Pressable: host("Pressable"),
    RefreshControl: host("RefreshControl"),
    ScrollView: (props: { children?: unknown; refreshControl?: unknown }) =>
      React.createElement("ScrollView", null, props.refreshControl as never, props.children as never),
    StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
    Text: host("Text"),
    View: host("View")
  };
});
vi.mock("react-native-reanimated", async () => {
  const React = await import("react");
  return { default: { View: (props: { children?: unknown }) => React.createElement("AnimatedView", null, props.children as never) } };
});
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("expo-router", async () => {
  const React = await import("react");
  return {
    router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
    useFocusEffect: (effect: () => void | (() => void)) => React.useEffect(effect, [effect])
  };
});
vi.mock("react-native-safe-area-context", async () => {
  const React = await import("react");
  return { SafeAreaView: (props: { children?: unknown }) => React.createElement("SafeAreaView", null, props.children as never) };
});
vi.mock("@/components/BlocksNavHeader", () => ({ BlocksNavHeader: () => null, usePreviousScreenLabel: () => "Settings" }));
vi.mock("@/components/blocks/BlocksConfirmSheet", () => ({ BlocksConfirmHost: () => null, useBlocksConfirm: () => ({ confirm: vi.fn() }) }));
vi.mock("@/components/blocks/BlocksEmptyState", () => ({ BlocksEmptyState: () => null }));
vi.mock("@/components/icons/DayframeIcon", () => ({ DayframeIcon: () => null }));
vi.mock("@/components/places/ArchivedPlacesGroup", async () => {
  const React = await import("react");
  return { ArchivedPlacesGroup: (props: Record<string, unknown>) => React.createElement("ArchivedGroup", props) };
});
vi.mock("@/components/places/ReflowBlockGroup", async () => {
  const React = await import("react");
  return { ReflowBlockGroup: (props: { children?: unknown; title: string }) => React.createElement("Group", { title: props.title }, props.children as never) };
});
vi.mock("@/components/places/PlaceRoleSheet", () => ({ PlaceRoleSheet: () => null }));
vi.mock("@/components/places/StoppedTripsGroup", () => ({ StoppedTripsGroup: () => null }));
vi.mock("@/components/settings/SettingsBlocks", () => ({ SettingsBlockGroup: () => null, SettingsBlockRow: () => null, SettingsPillButton: () => null }));
vi.mock("@/components/SwipeDismissSheet", () => ({ SwipeDismissSheet: () => null }));
vi.mock("@/lib/placesPage", () => import("../../lib/placesPage"));
vi.mock("@/lib/useArchivedPlaces", () => import("../../lib/useArchivedPlaces"));
vi.mock("@/lib/mobileAccount", () => factories.accountMock());
vi.mock("../../lib/mobileAccount", () => factories.accountMock());
vi.mock("@/lib/mobileTypography", () => ({ MOBILE_DISPLAY_FONT: { bold: "Display" }, mobileTextProps: () => ({}) }));
vi.mock("@/lib/api", () => factories.apiMock());
vi.mock("../../lib/api", () => factories.apiMock());
vi.mock("@/lib/friendlyError", () => factories.friendlyMock());
vi.mock("../../lib/friendlyError", () => factories.friendlyMock());
vi.mock("@/lib/geofence", () => ({ refreshGeofencesForPlaces: (places: unknown, owner: unknown) => mocks.refreshGeofences(places, owner) }));
vi.mock("@/lib/locationGeocoding", () => ({ backfillLearnedPlaceLocations: async () => [] }));
vi.mock("@/lib/localMutation", () => ({ applyAfterSuccessfulMutation: vi.fn() }));
vi.mock("@/lib/places", () => ({ withRole: <T extends { role?: unknown }>(place: T) => ({ ...place, role: place.role ?? null }) }));
vi.mock("@/lib/learnedPlaces", () => ({ copyLearnedPlaceDetail: vi.fn(), learnedPlaceDetailValues: vi.fn() }));
vi.mock("@/lib/mobileTheme", () => ({ pressable: (value: unknown) => value, useMobileTheme: () => ({ styles: {}, theme: {} }) }));
vi.mock("@/lib/motion", () => ({
  localLayoutTransition: () => null,
  localPresenceEntering: () => null,
  localPresenceExiting: () => null,
  useReduceMotionPreference: () => false
}));

const { default: PlacesScreen } = await import("../../../app/places");

// Synthetic accounts and places.
const ACCOUNT_A = { userId: "user-a", workspaceId: "ws-1" };
const ACCOUNT_B = { userId: "user-b", workspaceId: "ws-1" };
const gym = { id: "30000000-0000-4000-8000-000000000009", name: "Example Gym", radiusMeters: 100, priority: 5, latitude: 10, longitude: 20 };
const studio = { id: "30000000-0000-4000-8000-000000000008", name: "Example Studio", radiusMeters: 100, priority: 5, latitude: 10.01, longitude: 20 };
const office = { id: "30000000-0000-4000-8000-000000000007", name: "Example Office", radiusMeters: 100, priority: 5, latitude: 11, longitude: 20 };
const archivedGym = { id: gym.id, name: gym.name, archivedAt: "2026-10-20T09:00:00.000Z" };
const bootstrapFor = (owner: Owner, places: unknown[]) => ({
  user: { id: owner.userId }, workspace: { id: owner.workspaceId }, places, learnedPlaces: [], categories: []
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let tree: ReturnType<typeof create> | undefined;
const all = (type: string) => tree!.root.findAll((node: ReactTestInstance) => (node.type as unknown) === type);
const texts = () => all("Text").map((node) => [node.props.children].flat(Infinity).filter((child) => typeof child === "string").join(""));
const waitingRow = (id: string) => tree!.root.findAll((node: ReactTestInstance) => node.props.testID === `places-restored-${id}` && (node.type as unknown) === "View");
const pullToRefresh = () => (all("RefreshControl")[0].props.onRefresh as () => Promise<void>)();
const restore = (place: { id: string; name: string }) => (all("ArchivedGroup")[0].props.onRestore as (place: unknown) => void)(place);
const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });

async function mountFor(owner: Owner, places: unknown[]) {
  mocks.owner = owner;
  mocks.fetchBootstrap.mockResolvedValue(bootstrapFor(owner, places));
  await act(async () => { tree = create(<PlacesScreen />); });
  await flush();
}

beforeEach(() => {
  mocks.epoch = 1;
  mocks.fetchArchivedPlaces.mockResolvedValue([archivedGym]);
  mocks.refreshGeofences.mockResolvedValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  vi.clearAllMocks();
  mocks.fetchBootstrap.mockReset();
  mocks.fetchArchivedPlaces.mockReset();
  mocks.setPlaceArchived.mockReset();
  mocks.refreshGeofences.mockReset();
});

describe("Places › Archived › Restore on the screen (Codex r2 on #508)", () => {
  it("never lets a page read from before an accepted restore settle it without the place", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    expect(all("ArchivedGroup")[0].props.places).toEqual([archivedGym]);
    // A pull-to-refresh is out (it read the list before the restore)…
    const older = deferred<unknown>();
    mocks.fetchBootstrap.mockReturnValueOnce(older.promise);
    let pulling!: Promise<void>;
    await act(async () => { pulling = pullToRefresh(); });
    // …the restore is accepted and its own refresh fails: the place waits under Saved places.
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchBootstrap.mockRejectedValueOnce(new Error("offline"));
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    await act(async () => { restore(archivedGym); });
    await flush();
    expect(waitingRow(gym.id)).toHaveLength(1);
    mocks.refreshGeofences.mockClear();
    // The older read lands without the place: it must not settle the waiting row or monitoring.
    await act(async () => { older.resolve(bootstrapFor(ACCOUNT_A, [studio])); await pulling; });
    await flush();
    expect(waitingRow(gym.id)).toHaveLength(1);
    expect(mocks.refreshGeofences).not.toHaveBeenCalled();
  });

  it("shows another account nothing of a restore whose refresh fails after the switch", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    const refresh = deferred<unknown>();
    mocks.fetchBootstrap.mockReturnValueOnce(refresh.promise);
    await act(async () => { restore(archivedGym); });
    await flush();
    // Signed into account B, whose list is now shown.
    mocks.owner = ACCOUNT_B;
    mocks.epoch = 2;
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_B, [office]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    mocks.announce.mockClear();
    await act(async () => { refresh.reject(new Error("offline")); });
    await flush();
    expect(texts().join(" ")).not.toContain("Example Gym");
    expect(mocks.announce).not.toHaveBeenCalled();
  });

  it("keeps an old lifetime's restore from changing the returning account's rows", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    const refresh = deferred<unknown>();
    mocks.fetchBootstrap.mockReturnValueOnce(refresh.promise);
    await act(async () => { restore(archivedGym); });
    await flush();
    // Away to B and back to A: a new lifetime of A.
    mocks.epoch = 3;
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    await act(async () => { refresh.reject(new Error("offline")); });
    await flush();
    expect(waitingRow(gym.id)).toHaveLength(0);
    expect(texts().join(" ")).not.toContain("Example Gym is restored");
  });

  it("clears the restore warning once a refreshed list brings the place back", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchBootstrap.mockRejectedValueOnce(new Error("offline"));
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    await act(async () => { restore(archivedGym); });
    await flush();
    expect(texts().join(" ")).toContain("Example Gym is restored, but Places couldn't refresh.");
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio, gym]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    expect(waitingRow(gym.id)).toHaveLength(0);
    expect(mocks.refreshGeofences).toHaveBeenLastCalledWith([studio, gym], { userId: "user-a", workspaceId: "ws-1" });
    expect(texts().join(" ")).not.toContain("Places couldn't refresh");
  });
});

const monitoredWith = (id: string) => mocks.refreshGeofences.mock.calls.filter(([list, owner]) =>
  (list as { id: string }[]).some((place) => place.id === id) && (owner as Owner).userId === "user-a");

describe("Places › Archived › Restore monitoring (Codex r3 on #508)", () => {
  it("never shows the next account a status line when an earlier restore's monitoring finishes late", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    // The restore's refresh lands, but A's monitoring is still running…
    const monitoring = deferred<number>();
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio, gym]));
    mocks.refreshGeofences.mockReturnValueOnce(monitoring.promise);
    await act(async () => { restore(archivedGym); });
    await flush();
    // …when account B signs in and its list is shown.
    mocks.owner = ACCOUNT_B;
    mocks.epoch = 2;
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_B, [office]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    mocks.announce.mockClear();
    await act(async () => { monitoring.resolve(1); });
    await flush();
    expect(texts().join(" ")).not.toContain("Example Gym");
    expect(mocks.announce).not.toHaveBeenCalled();
  });

  it("monitors a restored place that a pull showed before its own refresh failed", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    const ownRefresh = deferred<unknown>();
    mocks.fetchBootstrap.mockReturnValueOnce(ownRefresh.promise);
    await act(async () => { restore(archivedGym); });
    await flush();
    // A pull started after the restore was accepted shows the place…
    mocks.fetchBootstrap.mockResolvedValue(bootstrapFor(ACCOUNT_A, [studio, gym]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    // …then the restore's own refresh fails.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => { ownRefresh.reject(new Error("offline")); });
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await flush();
    expect(monitoredWith(gym.id).length).toBeGreaterThan(0);
    expect(waitingRow(gym.id)).toHaveLength(0);
    expect(texts().join(" ")).not.toContain("Places couldn't refresh");
  });

  it("keeps retrying until a list with the restored place has been monitored", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // The restore's refresh fails, and so does the first retry.
    mocks.fetchBootstrap.mockRejectedValue(new Error("offline"));
    await act(async () => { restore(archivedGym); });
    await flush();
    expect(waitingRow(gym.id)).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await flush();
    expect(monitoredWith(gym.id)).toHaveLength(0);
    // Back online: a later retry brings the place back and monitors it.
    mocks.fetchBootstrap.mockResolvedValue(bootstrapFor(ACCOUNT_A, [studio, gym]));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await flush();
    expect(monitoredWith(gym.id).length).toBeGreaterThan(0);
    expect(waitingRow(gym.id)).toHaveLength(0);
    // Settled: no further retries.
    const reads = mocks.fetchBootstrap.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(mocks.fetchBootstrap.mock.calls.length).toBe(reads);
  });
});

describe("Places › Archived › Restore when monitoring fails (Codex r4 on #508)", () => {
  it("retries monitoring that failed after its list applied, and says so honestly until it lands", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // The restore's own refresh applies a list with the place, but monitoring from it fails.
    mocks.fetchBootstrap.mockResolvedValue(bootstrapFor(ACCOUNT_A, [studio, gym]));
    mocks.refreshGeofences.mockRejectedValueOnce(new Error("location unavailable"));
    mocks.announce.mockClear();
    await act(async () => { restore(archivedGym); });
    await flush();
    expect(monitoredWith(gym.id)).toHaveLength(1);
    // Not announced or shown as complete while visits there aren't noticed.
    expect(mocks.announce).not.toHaveBeenCalledWith("Example Gym restored.");
    expect(mocks.announce).toHaveBeenCalledWith("Example Gym is restored, but visits there aren't noticed yet. Dayframe will keep trying.");
    expect(texts().join(" ")).toContain("visits there aren't noticed yet");
    // Monitoring recovers: a retry refreshes it and says so once.
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    await flush();
    expect(monitoredWith(gym.id).length).toBeGreaterThan(1);
    expect(mocks.announce).toHaveBeenCalledWith("Example Gym restored. Visits there are noticed again.");
    expect(texts().join(" ")).not.toContain("aren't noticed yet");
    const attempts = mocks.refreshGeofences.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(mocks.refreshGeofences.mock.calls.length).toBe(attempts);
  });
});

describe("Places › Archived › Restore of a place that is gone again (owner follow-up on #508)", () => {
  it("settles silently when a read started after the restore lacks the place", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // The restore's own refresh fails: the place waits, with its warning, and retries start.
    mocks.fetchBootstrap.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { restore(archivedGym); });
    await flush();
    expect(waitingRow(gym.id)).toHaveLength(1);
    expect(texts().join(" ")).toContain("Places couldn't refresh");
    // Archived (or deleted) elsewhere since: a pull started after the restore no longer has it.
    mocks.announce.mockClear();
    mocks.fetchBootstrap.mockResolvedValue(bootstrapFor(ACCOUNT_A, [studio]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    expect(waitingRow(gym.id)).toHaveLength(0);
    expect(texts().join(" ")).not.toContain("Example Gym");
    expect(mocks.announce).not.toHaveBeenCalledWith(expect.stringContaining("restored"));
    // Nothing left to monitor: no more retries.
    const reads = mocks.fetchBootstrap.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(mocks.fetchBootstrap.mock.calls.length).toBe(reads);
  });

  it("says nothing of a restore whose own refresh no longer has the place, and stops", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Archived again elsewhere before the restore's own refresh read the list.
    mocks.fetchBootstrap.mockResolvedValue(bootstrapFor(ACCOUNT_A, [studio]));
    mocks.announce.mockClear();
    await act(async () => { restore(archivedGym); });
    await flush();
    expect(waitingRow(gym.id)).toHaveLength(0);
    expect(texts().join(" ")).not.toContain("Example Gym");
    expect(mocks.announce).not.toHaveBeenCalled();
    const reads = mocks.fetchBootstrap.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(mocks.fetchBootstrap.mock.calls.length).toBe(reads);
  });
});

// Read ordering (Codex r5 on #508): every page read takes a sequence when it starts; a list applies,
// settles restores and refreshes monitoring only when it is newer than the last list applied, in the
// same account lifetime, and no change happened since it started.
const savedRowIds = () => tree!.root.findAll((node: ReactTestInstance) => typeof node.props.testID === "string"
  && node.props.testID.startsWith("places-row-") && (node.type as unknown) === "Pressable")
  .map((node) => (node.props.testID as string).slice("places-row-".length)).sort();
const ids = (list: { id: string }[]) => list.map((place) => place.id).sort();
const monitoredLists = () => mocks.refreshGeofences.mock.calls.map(([list]) => ids(list as { id: string }[]).join(","));

type ReadKind = "pull" | "restore" | "retry";
async function startRead(kind: ReadKind, answer: Promise<unknown>) {
  mocks.fetchBootstrap.mockReturnValueOnce(answer);
  if (kind === "pull") {
    let pulling!: Promise<void>;
    await act(async () => { pulling = pullToRefresh(); });
    void pulling;
  } else if (kind === "restore") {
    await act(async () => { restore(archivedGym); });
  } else {
    // The restore is still unmonitored, so its retry runs after 5 s.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
  }
  await flush();
}

describe("Places read ordering (Codex r5 on #508)", () => {
  it("never lets an older restore refresh bring back a place a newer pull settled as gone", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    const held = deferred<unknown>();
    await startRead("restore", held.promise);
    // A newer pull: the place is gone again (archived elsewhere since).
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    expect(savedRowIds()).toEqual([studio.id]);
    mocks.refreshGeofences.mockClear();
    // The held, older restore refresh lands with the place.
    await act(async () => { held.resolve(bootstrapFor(ACCOUNT_A, [studio, gym])); });
    await flush();
    expect(savedRowIds()).toEqual([studio.id]);
    expect(waitingRow(gym.id)).toHaveLength(0);
    expect(monitoredWith(gym.id)).toHaveLength(0);
  });

  const listOlder = [studio, gym];
  const listNewer = [studio, gym, office];
  const cases: Array<[ReadKind, ReadKind, "older first" | "newer first"]> = [];
  for (const [first, second] of [["pull", "restore"], ["restore", "pull"], ["restore", "retry"]] as Array<[ReadKind, ReadKind]>) {
    cases.push([first, second, "older first"], [first, second, "newer first"]);
  }

  it.each(cases)("%s then %s, resolving %s: the newer read wins and the older never applies or monitors", async (first, second, order) => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const older = deferred<unknown>();
    const newer = deferred<unknown>();
    await startRead(first, older.promise);
    await startRead(second, newer.promise);
    mocks.refreshGeofences.mockClear();
    const resolveOlder = () => older.resolve(bootstrapFor(ACCOUNT_A, listOlder));
    const resolveNewer = () => newer.resolve(bootstrapFor(ACCOUNT_A, listNewer));
    // Monitoring calls from the moment the newer list can land on.
    let fromNewer = 0;
    for (const answer of order === "older first" ? [resolveOlder, resolveNewer] : [resolveNewer, resolveOlder]) {
      if (answer === resolveNewer) fromNewer = mocks.refreshGeofences.mock.calls.length;
      await act(async () => { answer(); });
      await flush();
    }
    expect(savedRowIds()).toEqual(ids(listNewer));
    // Once the newer list can land, the older one is never applied or monitored.
    expect(monitoredLists().slice(fromNewer)).not.toContain(ids(listOlder).join(","));
  });
});

