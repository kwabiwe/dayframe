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
  // Called whenever the screen reads the account lifetime (for probing the exact moment it is read).
  onEpochRead: null as null | (() => void),
  fetchBootstrap: vi.fn(),
  fetchArchivedPlaces: vi.fn(),
  setPlaceArchived: vi.fn(),
  setPlaceRole: vi.fn(),
  ignoreLearnedPlace: vi.fn(),
  copyDetail: vi.fn(),
  refreshGeofences: vi.fn(),
  announce: vi.fn()
}));

// One sign-in error class for every path that imports the API (the screen and the archived hook).
const authErrors = vi.hoisted(() => ({
  AuthRequiredError: class AuthRequiredError extends Error {},
  StaleMobileSessionResponseError: class StaleMobileSessionResponseError extends Error {}
}));

const factories = vi.hoisted(() => ({
  accountMock: () => ({
    currentMobileAccountEpoch: () => {
      const epoch = mocks.epoch;
      mocks.onEpochRead?.();
      return epoch;
    },
    getActiveMobileAccountSnapshot: () => mocks.owner,
    mobileAccountKey: (owner: Owner) => `${owner.workspaceId}:${owner.userId}`,
    mobileAccountOwnersEqual: (left: Owner | null | undefined, right: Owner | null | undefined) =>
      left?.userId === right?.userId && left?.workspaceId === right?.workspaceId,
    readActiveMobileAccount: async () => mocks.owner
  }),
  apiMock: () => {
    const { AuthRequiredError } = authErrors;
    return {
      AuthRequiredError,
      fetchArchivedPlaces: () => mocks.fetchArchivedPlaces(),
      fetchBootstrap: () => mocks.fetchBootstrap(),
      forgetLearnedPlace: vi.fn(),
      ignoreLearnedPlace: (id: string) => mocks.ignoreLearnedPlace(id),
      setPlaceArchived: (id: string, archived: boolean) => mocks.setPlaceArchived(id, archived),
      setPlaceRole: (request: unknown) => mocks.setPlaceRole(request)
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
// A confirmation is confirmed at once.
vi.mock("@/components/blocks/BlocksConfirmSheet", () => ({
  BlocksConfirmHost: () => null,
  useBlocksConfirm: () => ({ confirm: (options: { onConfirm: () => void }) => options.onConfirm() })
}));
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
// The Home/Work sheet keeps a draft (a typed rename) for as long as it stays mounted.
vi.mock("@/components/places/PlaceRoleSheet", async () => {
  const React = await import("react");
  return {
    PlaceRoleSheet: (props: Record<string, unknown>) => {
      const [draft, setDraft] = React.useState("");
      return React.createElement("RoleSheet", { ...props, draft, setDraft });
    }
  };
});
vi.mock("@/components/places/StoppedTripsGroup", () => ({ StoppedTripsGroup: () => null }));
vi.mock("@/components/settings/SettingsBlocks", async () => {
  const React = await import("react");
  return {
    SettingsBlockGroup: (props: { children?: unknown }) => React.createElement("BlockGroup", null, props.children as never),
    SettingsBlockRow: (props: { control?: unknown }) => React.createElement("BlockRow", null, props.control as never),
    SettingsPillButton: (props: Record<string, unknown>) => React.createElement("Pill", props)
  };
});
// Sheets draw their content, so controls inside them (a learned place's Copy) can be pressed.
vi.mock("@/components/SwipeDismissSheet", async () => {
  const React = await import("react");
  return {
    SwipeDismissSheet: React.forwardRef((props: { children?: unknown }, _ref) => React.createElement("Sheet", null, props.children as never))
  };
});
vi.mock("@/lib/placesPage", () => import("../../lib/placesPage"));
vi.mock("@/lib/useArchivedPlaces", () => import("../../lib/useArchivedPlaces"));
vi.mock("@/lib/mobileAccount", () => factories.accountMock());
vi.mock("../../lib/mobileAccount", () => factories.accountMock());
vi.mock("@/lib/mobileTypography", () => ({ MOBILE_DISPLAY_FONT: { bold: "Display" }, mobileTextProps: () => ({}) }));
vi.mock("@/lib/api", () => factories.apiMock());
vi.mock("../../lib/api", () => factories.apiMock());
vi.mock("@/lib/friendlyError", () => factories.friendlyMock());
vi.mock("@/lib/mobile-network", () => ({ StaleMobileSessionResponseError: authErrors.StaleMobileSessionResponseError }));
vi.mock("../../lib/mobile-network", () => ({ StaleMobileSessionResponseError: authErrors.StaleMobileSessionResponseError }));
vi.mock("../../lib/friendlyError", () => factories.friendlyMock());
vi.mock("@/lib/geofence", () => ({ refreshGeofencesForPlaces: (places: unknown, owner: unknown) => mocks.refreshGeofences(places, owner) }));
vi.mock("@/lib/locationGeocoding", () => ({ backfillLearnedPlaceLocations: async () => [] }));
vi.mock("@/lib/localMutation", () => import("../../lib/localMutation"));
vi.mock("@/lib/places", () => ({ withRole: <T extends { role?: unknown }>(place: T) => ({ ...place, role: place.role ?? null }) }));
vi.mock("@/lib/learnedPlaces", () => ({
  copyLearnedPlaceDetail: (value: string | null) => mocks.copyDetail(value),
  learnedPlaceDetailValues: (place: { name: string }) => ({ name: place.name, address: "1 Example Street, Exampleton", coordinates: null })
}));
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
const bootstrapFor = (owner: Owner, places: unknown[], learnedPlaces: unknown[] = []) => ({
  user: { id: owner.userId }, workspace: { id: owner.workspaceId }, places, learnedPlaces, categories: []
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
  mocks.onEpochRead = null;
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
  mocks.setPlaceRole.mockReset();
  mocks.ignoreLearnedPlace.mockReset();
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


// Codex r6 on #508: an accepted archive or delete drops every read already out (the next list comes
// from after it); monitoring follows the newest list (latest wins); a follow-up of a list a change
// has since overtaken settles nothing; only the newest read's failure is shown or announced.
describe("Places read ordering and monitoring (Codex r6 on #508)", () => {
  const ACCOUNT_A_KEY = "ws-1:user-a";
  const noteArchived = async (id: string) => {
    const { notePlaceDeleted } = await import("../../lib/placesPage");
    await act(async () => { notePlaceDeleted(ACCOUNT_A_KEY, id); });
    await flush();
  };

  it("never lets an opening read bring back a place archived before anything was shown", async () => {
    mocks.owner = ACCOUNT_A;
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    const opening = deferred<unknown>();
    const focused = deferred<unknown>();
    // Both opening reads (mount and focus) read the list before the archive; any read after it doesn't have the place.
    mocks.fetchBootstrap.mockReturnValueOnce(opening.promise).mockReturnValueOnce(focused.promise)
      .mockResolvedValue(bootstrapFor(ACCOUNT_A, [studio]));
    await act(async () => { tree = create(<PlacesScreen />); });
    await flush();
    expect(mocks.fetchBootstrap).toHaveBeenCalledTimes(2);
    await noteArchived(gym.id);
    await act(async () => { opening.resolve(bootstrapFor(ACCOUNT_A, [studio, gym])); });
    await flush();
    await act(async () => { focused.resolve(bootstrapFor(ACCOUNT_A, [studio, gym])); });
    await flush();
    expect(savedRowIds()).toEqual([studio.id]);
    expect(mocks.refreshGeofences.mock.calls.filter(([list]) => (list as { id: string }[]).some((place) => place.id === gym.id))).toHaveLength(0);
  });

  it("monitors the newest list when it removes a restored place during older monitoring", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio, gym]));
    const monitoring = deferred<number>();
    mocks.refreshGeofences.mockReturnValueOnce(monitoring.promise);
    await act(async () => { restore(archivedGym); });
    await flush();
    expect(monitoredLists()).toEqual([ids([studio, gym]).join(",")]);
    // A newer pull: the restored place is gone again, and another place is new.
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio, office]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    await act(async () => { monitoring.resolve(1); });
    await flush();
    expect(savedRowIds()).toEqual(ids([studio, office]));
    expect(mocks.refreshGeofences).toHaveBeenLastCalledWith([studio, office], ACCOUNT_A);
  });

  it("settles and announces nothing when monitoring finishes after an archive removed the restored place", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio, gym]));
    const monitoring = deferred<number>();
    mocks.refreshGeofences.mockReturnValueOnce(monitoring.promise);
    await act(async () => { restore(archivedGym); });
    await flush();
    await noteArchived(gym.id);
    expect(savedRowIds()).toEqual([studio.id]);
    mocks.announce.mockClear();
    await act(async () => { monitoring.resolve(1); });
    await flush();
    expect(texts().join(" ")).not.toContain("Example Gym");
    expect(mocks.announce).not.toHaveBeenCalled();
    // Monitoring's last input is the list shown now.
    expect(mocks.refreshGeofences).toHaveBeenLastCalledWith([studio], ACCOUNT_A);
  });

  it("does not announce recovery when an archive overtakes a pull's monitoring", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    mocks.fetchBootstrap.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { restore(archivedGym); });
    await flush();
    expect(waitingRow(gym.id)).toHaveLength(1);
    const monitoring = deferred<number>();
    mocks.refreshGeofences.mockReturnValueOnce(monitoring.promise);
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio, gym]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    await noteArchived(gym.id);
    expect(savedRowIds()).toEqual([studio.id]);
    mocks.announce.mockClear();
    await act(async () => { monitoring.resolve(1); });
    await flush();
    expect(mocks.announce).not.toHaveBeenCalled();
    expect(waitingRow(gym.id)).toHaveLength(0);
  });

  it("keeps a newer pull's failure line when an older restore refresh fails after it", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    const older = deferred<unknown>();
    mocks.fetchBootstrap.mockReturnValueOnce(older.promise);
    await act(async () => { restore(archivedGym); });
    await flush();
    mocks.fetchBootstrap.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await pullToRefresh(); });
    await flush();
    expect(texts()).toContain("Couldn't refresh your places. Try again.");
    await act(async () => { older.reject(new Error("offline")); });
    await flush();
    // The one status line is still the newer pull's; the restore still waits under Saved places.
    expect(texts().filter((line) => /couldn't refresh/i.test(line))).toEqual(["Couldn't refresh your places. Try again."]);
    expect(waitingRow(gym.id)).toHaveLength(1);
  });

  it("never says Places couldn't refresh for an older restore read once a newer list shows the place", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    const older = deferred<unknown>();
    mocks.fetchBootstrap.mockReturnValueOnce(older.promise);
    await act(async () => { restore(archivedGym); });
    await flush();
    // A newer pull shows the place, but monitoring from it fails.
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio, gym]));
    mocks.refreshGeofences.mockRejectedValueOnce(new Error("location unavailable"));
    await act(async () => { await pullToRefresh(); });
    await flush();
    expect(savedRowIds()).toEqual(ids([studio, gym]));
    mocks.announce.mockClear();
    await act(async () => { older.reject(new Error("offline")); });
    await flush();
    expect(texts().join(" ")).not.toContain("Places couldn't refresh");
    expect(mocks.announce).not.toHaveBeenCalledWith(expect.stringContaining("Places couldn't refresh"));
  });
});

// Codex r7 on #508: an overtaken restore never removes a newer Archived row; queued monitoring never
// starts outside its account lifetime or after the page closes; retries never starve settlement
// (every successful refresh settles what the shown list has); only the newest read writes the line.
describe("Places restore recovery (Codex r7 on #508)", () => {
  const noteArchived = async (id: string) => {
    const { notePlaceDeleted } = await import("../../lib/placesPage");
    await act(async () => { notePlaceDeleted("ws-1:user-a", id); });
    await flush();
  };
  const archivedRows = () => all("ArchivedGroup")[0].props.places;

  it("keeps a newer Archived row when an overtaken restore refresh settles (archived here)", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    const held = deferred<unknown>();
    mocks.fetchBootstrap.mockReturnValueOnce(held.promise);
    await act(async () => { restore(archivedGym); });
    await flush();
    // Archived again from the editor: the archived read after it has the place.
    mocks.fetchArchivedPlaces.mockResolvedValue([archivedGym]);
    await noteArchived(gym.id);
    expect(archivedRows()).toEqual([archivedGym]);
    mocks.fetchArchivedPlaces.mockRejectedValue(new Error("offline"));
    await act(async () => { held.resolve(bootstrapFor(ACCOUNT_A, [studio, gym])); });
    await flush();
    expect(savedRowIds()).toEqual([studio.id]);
    expect(archivedRows()).toEqual([archivedGym]);
  });

  it("keeps a newer Archived row when an overtaken restore refresh settles (archived elsewhere)", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    const held = deferred<unknown>();
    mocks.fetchBootstrap.mockReturnValueOnce(held.promise);
    await act(async () => { restore(archivedGym); });
    await flush();
    mocks.fetchArchivedPlaces.mockResolvedValue([archivedGym]);
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    expect(archivedRows()).toEqual([archivedGym]);
    mocks.announce.mockClear();
    mocks.fetchArchivedPlaces.mockRejectedValue(new Error("offline"));
    await act(async () => { held.resolve(bootstrapFor(ACCOUNT_A, [studio, gym])); });
    await flush();
    expect(savedRowIds()).toEqual([studio.id]);
    expect(waitingRow(gym.id)).toHaveLength(0);
    expect(mocks.announce).not.toHaveBeenCalled();
    expect(archivedRows()).toEqual([archivedGym]);
  });

  async function holdMonitoringWithQueuedList() {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio, gym]));
    const held = deferred<number>();
    mocks.refreshGeofences.mockReturnValueOnce(held.promise);
    await act(async () => { restore(archivedGym); });
    await flush();
    // A newer list waits behind the running refresh.
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio, gym, office]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    expect(mocks.refreshGeofences).toHaveBeenCalledTimes(1);
    return held;
  }

  it("never starts queued monitoring in a later account lifetime", async () => {
    const held = await holdMonitoringWithQueuedList();
    // Away to another account and back: a new lifetime.
    mocks.epoch += 2;
    mocks.fetchBootstrap.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await pullToRefresh(); });
    await flush();
    await act(async () => { held.resolve(1); });
    await flush();
    expect(mocks.refreshGeofences).toHaveBeenCalledTimes(1);
  });

  it("never starts queued monitoring after the page closes", async () => {
    const held = await holdMonitoringWithQueuedList();
    act(() => tree!.unmount());
    tree = undefined;
    await act(async () => { held.resolve(1); });
    await flush();
    expect(mocks.refreshGeofences).toHaveBeenCalledTimes(1);
  });

  it("settles a restore whose slow monitoring keeps being overtaken by retries, and frees Restore", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchArchivedPlaces.mockResolvedValue([{ id: office.id, name: office.name, archivedAt: archivedGym.archivedAt }]);
    mocks.fetchBootstrap.mockResolvedValue(bootstrapFor(ACCOUNT_A, [studio, gym]));
    // Every refresh succeeds, but takes longer than the longest retry gap.
    mocks.refreshGeofences.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(1), 75_000)));
    await act(async () => { restore(archivedGym); });
    await flush();
    for (let second = 0; second < 400; second += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }
    expect(mocks.announce).toHaveBeenCalledWith("Example Gym restored.");
    expect(waitingRow(gym.id)).toHaveLength(0);
    // Recovery is over: no more retries, and Restore takes another place.
    const reads = mocks.fetchBootstrap.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(mocks.fetchBootstrap.mock.calls.length).toBe(reads);
    const restores = mocks.setPlaceArchived.mock.calls.length;
    await act(async () => { restore({ id: office.id, name: office.name }); });
    await flush();
    expect(mocks.setPlaceArchived.mock.calls.length).toBe(restores + 1);
  });

  it("keeps a newer pull's failure line when older restore monitoring finally succeeds", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio, gym]));
    const held = deferred<number>();
    mocks.refreshGeofences.mockReturnValueOnce(held.promise);
    await act(async () => { restore(archivedGym); });
    await flush();
    mocks.fetchBootstrap.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await pullToRefresh(); });
    await flush();
    expect(texts()).toContain("Couldn't refresh your places. Try again.");
    await act(async () => { held.resolve(1); });
    await flush();
    expect(texts()).toContain("Couldn't refresh your places. Try again.");
  });
});

// Codex r8 on #508: a queued refresh is checked and started in one synchronous step, and the status
// line belongs to the account lifetime that wrote it.
describe("Places account lifetime (Codex r8 on #508)", () => {
  it("never starts a queued refresh after its lifetime ends between the check and the start", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio, gym]));
    const held = deferred<number>();
    const startedIn: number[] = [];
    mocks.refreshGeofences.mockImplementation(() => {
      startedIn.push(mocks.epoch);
      return startedIn.length === 1 ? held.promise : Promise.resolve(1);
    });
    await act(async () => { restore(archivedGym); });
    await flush();
    // A newer list waits behind the running refresh.
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio, gym, office]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    expect(startedIn).toEqual([1]);
    // The lifetime ends in the very next microtask after the queue's eligibility check reads it.
    mocks.onEpochRead = () => {
      mocks.onEpochRead = null;
      queueMicrotask(() => { mocks.epoch += 2; });
    };
    await act(async () => { held.resolve(1); });
    await flush();
    // Whatever started, started in the lifetime that asked for it.
    expect(startedIn.every((epoch) => epoch === 1)).toBe(true);
  });

  it("never shows the next account a restore warning naming the previous account's place", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    mocks.fetchBootstrap.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { restore(archivedGym); });
    await flush();
    expect(texts().join(" ")).toContain("Example Gym is restored, but Places couldn't refresh.");
    // Signed into B on the open page, whose places then load.
    mocks.owner = ACCOUNT_B;
    mocks.epoch = 2;
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_B, [office]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    expect(savedRowIds()).toEqual([office.id]);
    expect(texts().join(" ")).not.toContain("Example Gym");
  });

  it("never shows a returning account's new lifetime the old lifetime's status line", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    mocks.setPlaceArchived.mockResolvedValue({ ...archivedGym, archivedAt: null });
    mocks.fetchArchivedPlaces.mockResolvedValue([]);
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio, gym]));
    await act(async () => { restore(archivedGym); });
    await flush();
    expect(texts()).toContain("Example Gym restored.");
    // Away to B and back to A: a new lifetime of A, whose list loads.
    mocks.epoch = 3;
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio, gym]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    expect(texts()).not.toContain("Example Gym restored.");
  });
});

// Codex r9 on #508: every per-account piece of Places state, run as A acts → B acts → A returns (a
// new lifetime of A). Lasting state (restores still to be monitored) is kept per account and comes
// back with A; transient state (problem and status lines, the busy pill, the restore gate,
// announcements) belongs to the lifetime that made it. Nothing of B's touches A's, and nothing of
// A's shows to B.
describe("Places state per account and lifetime (Codex r9 on #508)", () => {
  const ACCOUNT_B_PLACE = { id: "30000000-0000-4000-8000-000000000006", name: "Example Library", radiusMeters: 100, priority: 5, latitude: 12, longitude: 20 };
  const archivedOffice = { id: office.id, name: office.name, archivedAt: "2026-10-20T09:00:00.000Z" };
  const offline = () => new Error("offline");
  let placesOf: Record<string, unknown[]>;

  async function showAccount(owner: Owner, epoch: number) {
    mocks.owner = owner;
    mocks.epoch = epoch;
    await act(async () => { await pullToRefresh(); });
    await flush();
  }
  async function restoreNow(place: { id: string; name: string }) {
    await act(async () => { restore(place); });
    await flush();
  }
  const archivedGroup = () => all("ArchivedGroup")[0].props as { places: { id: string }[]; problem: string | null; restoringId: string | null };
  const screenText = () => [...texts(), archivedGroup().problem ?? ""].join(" ");

  type Row = {
    name: string;
    aActs: () => Promise<void>;
    bActs: () => Promise<void>;
    afterAReturns?: () => Promise<void>;
    expectA: () => void;
    /** A's places at first, and on returning (the server's word by then); default Studio, then Studio and Gym. */
    aPlaces?: unknown[];
    aPlacesOnReturn?: unknown[];
  };
  const rows: Row[] = [
    {
      name: "restores still to be monitored come back with A, whatever B restored",
      aActs: async () => {
        mocks.fetchBootstrap.mockRejectedValueOnce(offline());
        await restoreNow(archivedGym);
        expect(waitingRow(gym.id)).toHaveLength(1);
      },
      bActs: async () => {
        mocks.fetchBootstrap.mockRejectedValueOnce(offline());
        await restoreNow(archivedOffice);
      },
      expectA: () => {
        expect(monitoredWith(gym.id).length).toBeGreaterThan(0);
        expect(waitingRow(gym.id)).toHaveLength(0);
      }
    },
    {
      name: "a refused restore's problem line stays in its lifetime",
      aActs: async () => {
        mocks.setPlaceArchived.mockRejectedValueOnce(offline());
        await restoreNow(archivedGym);
        expect(archivedGroup().problem).toBe("Couldn't restore Example Gym. Try again.");
      },
      bActs: async () => {
        // B's own restore goes through, with nothing of A's problem line.
        expect(archivedGroup().problem).toBeNull();
        await restoreNow(archivedOffice);
        expect(archivedGroup().problem).toBeNull();
      },
      expectA: () => {
        expect(archivedGroup().problem).toBeNull();
      }
    },
    {
      name: "a restore's status line stays in its lifetime",
      aActs: async () => {
        mocks.fetchBootstrap.mockRejectedValueOnce(offline());
        await restoreNow(archivedGym);
        expect(texts().join(" ")).toContain("Example Gym is restored, but Places couldn't refresh.");
      },
      bActs: async () => {
        mocks.fetchBootstrap.mockRejectedValueOnce(offline());
        await restoreNow(archivedOffice);
      },
      expectA: () => {
        expect(texts().join(" ")).not.toContain("is restored, but");
      }
    },
    {
      name: "a restore still out holds neither the busy pill nor the gate in a later lifetime",
      aActs: async () => {
        mocks.setPlaceArchived.mockReturnValueOnce(new Promise(() => undefined));
        await restoreNow(archivedGym);
        expect(archivedGroup().restoringId).toBe(gym.id);
      },
      bActs: async () => {
        // B only looks: A's request still out shows B no busy pill.
        expect(archivedGroup().restoringId).toBeNull();
      },
      expectA: () => {
        expect(mocks.setPlaceArchived).toHaveBeenLastCalledWith(gym.id, false);
        expect(mocks.setPlaceArchived).toHaveBeenCalledTimes(2);
      },
      afterAReturns: async () => {
        expect(archivedGroup().restoringId).toBeNull();
        // Restore takes A's place again in the new lifetime.
        mocks.setPlaceArchived.mockReturnValueOnce(new Promise(() => undefined));
        await restoreNow(archivedGym);
      }
    },
    {
      name: "a restore answered in a later lifetime announces and says nothing",
      aActs: async () => {
        mocks.setPlaceArchived.mockReturnValueOnce(answerA.promise);
        await restoreNow(archivedGym);
      },
      bActs: async () => undefined,
      expectA: () => {
        expect(mocks.announce).not.toHaveBeenCalled();
        expect(texts().join(" ")).not.toContain("Example Gym restored");
      },
      afterAReturns: async () => {
        mocks.announce.mockClear();
        await act(async () => { answerA.resolve({ ...archivedGym, archivedAt: null }); });
        await flush();
      }
    }
  ];
  // Codex r10 on #508: the Home/Work sheet and its draft, role saves and Replace, the learned-place
  // sheet and its Ignore, and the place editor's hand-off follow the same rule.
  const homeA = { id: "30000000-0000-4000-8000-000000000011", name: "Example House", role: "home", radiusMeters: 100, priority: 5, latitude: 10, longitude: 30 };
  const homeB = { id: "30000000-0000-4000-8000-000000000012", name: "Example Flat", role: null, radiusMeters: 100, priority: 5, latitude: 10.001, longitude: 30 };
  const homeC = { id: "30000000-0000-4000-8000-000000000013", name: "Example Loft", role: "home", radiusMeters: 100, priority: 5, latitude: 10.002, longitude: 30 };
  const learnedCafe = {
    id: "40000000-0000-4000-8000-000000000001", name: "Example Cafe", classification: "place_candidate", visitCount: 3,
    distinctDayCount: 2, lastSeenAt: "2026-10-19T09:00:00.000Z", radiusMeters: 80, totalDwellSeconds: 3_600, longestDwellSeconds: 1_800
  };
  const roleSheets = () => all("RoleSheet");
  const pill = (label: string) => all("Pill").find((node) => node.props.accessibilityLabel === label);
  const learnedSheet = () => tree!.root.findAll((node: ReactTestInstance) => typeof node.type === "function" && "onIgnore" in node.props)[0];
  rows.push(
    {
      name: "the Home/Work sheet and its draft stay in the lifetime that opened them",
      aActs: async () => {
        await act(async () => { (pill("Set Home")!.props.onPress as () => void)(); });
        await act(async () => { (roleSheets()[0].props.setDraft as (value: string) => void)("Old home name"); });
        expect(roleSheets()[0].props.draft).toBe("Old home name");
      },
      bActs: async () => {
        expect(roleSheets()).toHaveLength(0);
      },
      expectA: () => undefined,
      afterAReturns: async () => {
        expect(roleSheets()).toHaveLength(0);
        // Opened again, it starts a fresh draft.
        await act(async () => { (pill("Set Home")!.props.onPress as () => void)(); });
        expect(roleSheets()).toHaveLength(1);
        expect(roleSheets()[0].props.draft).toBe("");
      }
    },
    {
      name: "a Replace answered in a later lifetime never changes the returning account's newer Home",
      aPlaces: [homeA, homeB],
      aPlacesOnReturn: [homeB, homeC],
      aActs: async () => {
        mocks.setPlaceRole.mockReturnValueOnce(answerA.promise);
        await act(async () => { (pill("Change Home")!.props.onPress as () => void)(); });
        const onSave = roleSheets()[0].props.onSave as (request: unknown) => Promise<string | null>;
        void onSave({ role: "home", placeId: homeB.id, previousPlaceName: null, archivePrevious: true });
        await flush();
      },
      bActs: async () => undefined,
      expectA: () => {
        expect(savedRowIds()).toEqual(ids([homeB, homeC]));
        expect(texts().join(" ")).not.toContain("Home updated");
        expect(mocks.refreshGeofences.mock.calls.filter(([list]) => (list as { id: string }[]).every((place) => place.id !== homeC.id))).toHaveLength(0);
      },
      afterAReturns: async () => {
        mocks.refreshGeofences.mockClear();
        mocks.fetchBootstrap.mockRejectedValueOnce(offline());
        await act(async () => { answerA.resolve({ ok: true, previousArchived: true }); });
        await flush();
      }
    },
    {
      name: "a Home/Work save still out never holds a later lifetime's sheet",
      aPlaces: [homeA, homeB],
      aPlacesOnReturn: [homeA, homeB],
      aActs: async () => {
        mocks.setPlaceRole.mockReturnValueOnce(new Promise(() => undefined));
        await act(async () => { (pill("Change Home")!.props.onPress as () => void)(); });
        await act(async () => { (roleSheets()[0].props.setDraft as (value: string) => void)("Old home name"); });
        const onSave = roleSheets()[0].props.onSave as (request: unknown) => Promise<string | null>;
        void onSave({ role: "home", placeId: homeB.id, previousPlaceName: null });
        await flush();
      },
      bActs: async () => undefined,
      expectA: () => {
        // A fresh sheet opened in the new lifetime.
        expect(roleSheets()).toHaveLength(1);
        expect(roleSheets()[0].props.draft).toBe("");
      },
      afterAReturns: async () => {
        await act(async () => { (pill("Change Home")!.props.onPress as () => void)(); });
      }
    },
    {
      name: "the learned-place sheet stays in the lifetime that opened it",
      aActs: async () => {
        await act(async () => { (tree!.root.findAll((node: ReactTestInstance) => node.props.testID === `places-learned-${learnedCafe.id}` && (node.type as unknown) === "Pressable")[0].props.onPress as () => void)(); });
        expect(learnedSheet().props.learnedPlace).toEqual(learnedCafe);
      },
      bActs: async () => {
        expect(learnedSheet().props.learnedPlace).toBeNull();
      },
      expectA: () => {
        expect(learnedSheet().props.learnedPlace).toBeNull();
      }
    },
    {
      name: "a learned place's Ignore answered in a later lifetime changes and says nothing",
      aActs: async () => {
        mocks.ignoreLearnedPlace.mockReturnValueOnce(answerA.promise);
        await act(async () => { (tree!.root.findAll((node: ReactTestInstance) => node.props.testID === `places-learned-${learnedCafe.id}` && (node.type as unknown) === "Pressable")[0].props.onPress as () => void)(); });
        await act(async () => { (learnedSheet().props.onIgnore as (place: unknown, done: () => void) => void)(learnedCafe, () => undefined); });
        await flush();
      },
      bActs: async () => undefined,
      expectA: () => {
        expect(texts().join(" ")).not.toContain("Learned place ignored");
      },
      afterAReturns: async () => {
        const reads = mocks.fetchBootstrap.mock.calls.length;
        await act(async () => { answerA.resolve({ ok: true }); });
        await flush();
        // No refresh after it either.
        expect(mocks.fetchBootstrap.mock.calls.length).toBe(reads);
      }
    },
    {
      name: "the place editor's late archive for A never touches B's list",
      aActs: async () => undefined,
      bActs: async () => {
        const { notePlaceDeleted } = await import("../../lib/placesPage");
        await act(async () => { notePlaceDeleted("ws-1:user-a", studio.id); });
        await flush();
        expect(savedRowIds()).toEqual([ACCOUNT_B_PLACE.id]);
      },
      expectA: () => undefined,
      afterAReturns: async () => {
        // A's hand-off still waits for A's Places (taken here so nothing carries into later tests).
        const { takeDeletedPlaces } = await import("../../lib/placesPage");
        expect(takeDeletedPlaces("ws-1:user-a")).toEqual([studio.id]);
      }
    }
  );
  let answerA: ReturnType<typeof deferred<unknown>>;

  it.each(rows)("$name", async (row) => {
    answerA = deferred<unknown>();
    placesOf = { "user-a": row.aPlaces ?? [studio], "user-b": [ACCOUNT_B_PLACE] };
    const archivedOf: Record<string, unknown[]> = { "user-a": [archivedGym], "user-b": [archivedOffice] };
    await mountFor(ACCOUNT_A, [studio]);
    mocks.fetchBootstrap.mockImplementation(async () => bootstrapFor(
      mocks.owner!, placesOf[mocks.owner!.userId], mocks.owner!.userId === "user-a" ? [learnedCafe] : []
    ));
    mocks.fetchArchivedPlaces.mockImplementation(async () => archivedOf[mocks.owner!.userId]);
    mocks.setPlaceArchived.mockResolvedValue({ archivedAt: null });
    await showAccount(ACCOUNT_A, 1);
    await row.aActs();
    // B signs in on the open page and acts; nothing of A's shows to B.
    await showAccount(ACCOUNT_B, 2);
    expect(screenText()).not.toContain("Example Gym");
    await row.bActs();
    expect(screenText()).not.toContain("Example Gym");
    // A returns in a new lifetime; the server now has A's restored place active.
    placesOf["user-a"] = row.aPlacesOnReturn ?? [studio, gym];
    archivedOf["user-a"] = [];
    mocks.announce.mockClear();
    await showAccount(ACCOUNT_A, 3);
    await row.afterAReturns?.();
    // Nothing of B's touches A.
    expect(screenText()).not.toContain("Example Office");
    expect(screenText()).not.toContain("Example Library");
    expect(roleSheets().every((sheet) => !String(sheet.props.draft).includes("Old home name"))).toBe(true);
    row.expectA();
  });
});

// Codex r11 on #508: a check before an await (or inside an awaited helper) is not a check for what
// runs after it. Each continuation asks the lifetime synchronously right before its first write,
// callback or announcement; busy state carries the lifetime and request that set it.
describe("Places continuations after an await (Codex r11 on #508)", () => {
  const cafe = {
    id: "40000000-0000-4000-8000-000000000002", name: "Example Bakery", classification: "place_candidate", visitCount: 3,
    distinctDayCount: 2, lastSeenAt: "2026-10-19T09:00:00.000Z", radiusMeters: 80, totalDwellSeconds: 3_600, longestDwellSeconds: 1_800
  };
  const kiosk = { ...cafe, id: "40000000-0000-4000-8000-000000000003", name: "Example Kiosk" };
  const learnedSheet = () => tree!.root.findAll((node: ReactTestInstance) => typeof node.type === "function" && "onIgnore" in node.props)[0];
  const openLearned = async (id: string) => {
    await act(async () => { (tree!.root.findAll((node: ReactTestInstance) => node.props.testID === `places-learned-${id}` && (node.type as unknown) === "Pressable")[0].props.onPress as () => void)(); });
  };
  const savePill = (name: string) => all("Pill").find((node) => node.props.accessibilityLabel === `Save ${name} as a place`)!;

  it("never announces a refused restore once another account took over between the check and the write", async () => {
    await mountFor(ACCOUNT_A, [studio]);
    const refused = deferred<unknown>();
    mocks.setPlaceArchived.mockReturnValueOnce(refused.promise);
    await act(async () => { restore(archivedGym); });
    await flush();
    const announcedIn: number[] = [];
    mocks.announce.mockImplementation(() => { announcedIn.push(mocks.epoch); });
    // B signs in in the microtask right after the lifetime is next read.
    mocks.onEpochRead = () => {
      mocks.onEpochRead = null;
      queueMicrotask(() => { mocks.owner = ACCOUNT_B; mocks.epoch = 2; });
    };
    await act(async () => { refused.reject(new Error("offline")); });
    await flush();
    expect(mocks.epoch).toBe(2);
    expect(announcedIn.filter((epoch) => epoch !== 1)).toEqual([]);
  });

  it("never lets an old Ignore close the sheet another account opened since", async () => {
    mocks.owner = ACCOUNT_A;
    mocks.fetchBootstrap.mockResolvedValue(bootstrapFor(ACCOUNT_A, [studio], [cafe]));
    await act(async () => { tree = create(<PlacesScreen />); });
    await flush();
    await openLearned(cafe.id);
    mocks.ignoreLearnedPlace.mockResolvedValueOnce({ ok: true });
    const refresh = deferred<unknown>();
    mocks.fetchBootstrap.mockReturnValueOnce(refresh.promise);
    const closeSheet = vi.fn();
    await act(async () => { (learnedSheet().props.onIgnore as (place: unknown, done: () => void) => void)(cafe, closeSheet); });
    await flush();
    // B signs in, loads its places and opens its own suggestion.
    mocks.owner = ACCOUNT_B;
    mocks.epoch = 2;
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_B, [office], [kiosk]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    await openLearned(kiosk.id);
    expect(learnedSheet().props.learnedPlace).toEqual(kiosk);
    await act(async () => { refresh.resolve(bootstrapFor(ACCOUNT_A, [studio], [])); });
    await flush();
    expect(closeSheet).not.toHaveBeenCalled();
    expect(learnedSheet().props.learnedPlace).toEqual(kiosk);
  });

  it("never leaves a returning account's suggestion busy from an Ignore of an earlier lifetime", async () => {
    mocks.owner = ACCOUNT_A;
    mocks.fetchBootstrap.mockResolvedValue(bootstrapFor(ACCOUNT_A, [studio], [cafe]));
    await act(async () => { tree = create(<PlacesScreen />); });
    await flush();
    await openLearned(cafe.id);
    mocks.ignoreLearnedPlace.mockReturnValueOnce(new Promise(() => undefined));
    await act(async () => { (learnedSheet().props.onIgnore as (place: unknown, done: () => void) => void)(cafe, () => undefined); });
    await flush();
    expect(savePill(cafe.name).props.disabled).toBe(true);
    // Away to B and back to A: a new lifetime of A.
    mocks.owner = ACCOUNT_B;
    mocks.epoch = 2;
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_B, [office], []));
    await act(async () => { await pullToRefresh(); });
    await flush();
    mocks.owner = ACCOUNT_A;
    mocks.epoch = 3;
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_A, [studio], [cafe]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    expect(savePill(cafe.name).props.disabled).toBe(false);
  });
});

// Codex r12 on #508: a "sign in again" answer to this page's own request opens sign-in when the app is
// now signed out, even though signing out also ended the page's lifetime; only another account having
// become active since makes it someone else's page (no redirect, nothing shown). A late copy never
// shows its toast in a sheet it didn't come from.
describe("Places sign-in after a lifetime ends (Codex r12 on #508)", () => {
  const bakery = {
    id: "40000000-0000-4000-8000-000000000004", name: "Example Deli", classification: "place_candidate", visitCount: 3,
    distinctDayCount: 2, lastSeenAt: "2026-10-19T09:00:00.000Z", radiusMeters: 80, totalDwellSeconds: 3_600, longestDwellSeconds: 1_800
  };
  const kiosk = { ...bakery, id: "40000000-0000-4000-8000-000000000005", name: "Example Stand" };
  const learnedSheet = () => tree!.root.findAll((node: ReactTestInstance) => typeof node.type === "function" && "onIgnore" in node.props)[0];
  const openLearned = async (id: string) => {
    await act(async () => { (tree!.root.findAll((node: ReactTestInstance) => node.props.testID === `places-learned-${id}` && (node.type as unknown) === "Pressable")[0].props.onPress as () => void)(); });
  };
  const pill = (label: string) => all("Pill").find((node) => node.props.accessibilityLabel === label)!;

  type Site = { name: string; start: (answer: Promise<unknown>) => Promise<void> };
  const sites: Site[] = [
    {
      name: "a page read",
      start: async (answer) => {
        mocks.fetchBootstrap.mockReturnValueOnce(answer);
        await act(async () => { void pullToRefresh(); });
      }
    },
    {
      name: "a Restore",
      start: async (answer) => {
        mocks.setPlaceArchived.mockReturnValueOnce(answer);
        await act(async () => { restore(archivedGym); });
      }
    },
    {
      name: "the refresh after a Restore",
      start: async (answer) => {
        mocks.setPlaceArchived.mockResolvedValueOnce({ ...archivedGym, archivedAt: null });
        mocks.fetchBootstrap.mockReturnValueOnce(answer);
        await act(async () => { restore(archivedGym); });
      }
    },
    {
      name: "a Home/Work save",
      start: async (answer) => {
        mocks.setPlaceRole.mockReturnValueOnce(answer);
        await act(async () => { (pill("Set Home").props.onPress as () => void)(); });
        await act(async () => { void (all("RoleSheet")[0].props.onSave as (request: unknown) => Promise<unknown>)({ role: "home", placeId: studio.id, previousPlaceName: null }); });
      }
    },
    {
      name: "an Ignore",
      start: async (answer) => {
        mocks.ignoreLearnedPlace.mockReturnValueOnce(answer);
        await openLearned(bakery.id);
        await act(async () => { (learnedSheet().props.onIgnore as (place: unknown, done: () => void) => void)(bakery, () => undefined); });
      }
    }
  ];
  const cases = sites.flatMap((site) => [
    { site, then: "signed out" as const },
    { site, then: "replaced by another account" as const }
  ]);

  it.each(cases)("$site.name answered \"sign in again\" after the app was $then", async ({ site, then }) => {
    const { AuthRequiredError } = await import("../../lib/api");
    const { router } = await import("expo-router");
    mocks.owner = ACCOUNT_A;
    mocks.fetchBootstrap.mockResolvedValue(bootstrapFor(ACCOUNT_A, [studio], [bakery]));
    await act(async () => { tree = create(<PlacesScreen />); });
    await flush();
    const answer = deferred<unknown>();
    await site.start(answer.promise);
    await flush();
    const before = texts();
    vi.mocked(router.replace).mockClear();
    mocks.announce.mockClear();
    // The session is invalidated (signed out), or another account is active now.
    mocks.owner = then === "signed out" ? null : ACCOUNT_B;
    mocks.epoch = 2;
    await act(async () => { answer.reject(new AuthRequiredError()); });
    await flush();
    if (then === "signed out") {
      expect(router.replace).toHaveBeenCalledWith("/");
    } else {
      expect(router.replace).not.toHaveBeenCalled();
      expect(mocks.announce).not.toHaveBeenCalled();
      // Nothing new is shown (A's own sheet may close: it is no longer the account shown).
      expect(texts().filter((line) => !before.includes(line))).toEqual([]);
    }
  });

  it("never shows a late copy's toast in a sheet another account opened since", async () => {
    mocks.owner = ACCOUNT_A;
    mocks.fetchBootstrap.mockResolvedValue(bootstrapFor(ACCOUNT_A, [studio], [bakery]));
    await act(async () => { tree = create(<PlacesScreen />); });
    await flush();
    await openLearned(bakery.id);
    const copying = deferred<boolean>();
    mocks.copyDetail.mockReturnValueOnce(copying.promise);
    await act(async () => { (pill("Copy address").props.onPress as () => void)(); });
    // B signs in, loads its places and opens its own suggestion.
    mocks.owner = ACCOUNT_B;
    mocks.epoch = 2;
    mocks.fetchBootstrap.mockResolvedValueOnce(bootstrapFor(ACCOUNT_B, [office], [kiosk]));
    await act(async () => { await pullToRefresh(); });
    await flush();
    await openLearned(kiosk.id);
    await act(async () => { copying.resolve(true); });
    await flush();
    expect(texts()).not.toContain("Address copied");
  });
});

// Codex r13 on #508: the Archived read's 401 can come first, signing the app out; the page's own read
// then answers "stale session". Sign-in still opens unless another account has become active.
describe("Places when the Archived read's 401 comes first (Codex r13 on #508)", () => {
  const cases = [
    { then: "signed out", owner: null as Owner | null, epoch: 2, opensSignIn: true },
    { then: "still signed in as the same account (not yet signed out)", owner: ACCOUNT_A as Owner | null, epoch: 1, opensSignIn: true },
    { then: "replaced by another account", owner: ACCOUNT_B as Owner | null, epoch: 2, opensSignIn: false }
  ];

  it.each(cases)("opens sign-in only when it should: $then", async ({ owner, epoch, opensSignIn }) => {
    const { AuthRequiredError } = await import("../../lib/api");
    const { router } = await import("expo-router");
    await mountFor(ACCOUNT_A, [studio]);
    const archivedRead = deferred<unknown>();
    const pageRead = deferred<unknown>();
    mocks.fetchArchivedPlaces.mockReturnValueOnce(archivedRead.promise);
    mocks.fetchBootstrap.mockReturnValueOnce(pageRead.promise);
    await act(async () => { void pullToRefresh(); });
    await flush();
    const before = texts();
    vi.mocked(router.replace).mockClear();
    mocks.owner = owner;
    mocks.epoch = epoch;
    // The Archived read's 401 lands first; the page's read then finds its session replaced.
    await act(async () => { archivedRead.reject(new AuthRequiredError()); });
    await flush();
    await act(async () => { pageRead.reject(new authErrors.StaleMobileSessionResponseError()); });
    await flush();
    if (opensSignIn) {
      expect(router.replace).toHaveBeenCalledWith("/");
    } else {
      expect(router.replace).not.toHaveBeenCalled();
      expect(texts().filter((line) => !before.includes(line))).toEqual([]);
    }
  });

  it("opens sign-in when the page's own read finds its session gone after signing out", async () => {
    const { router } = await import("expo-router");
    await mountFor(ACCOUNT_A, [studio]);
    const pageRead = deferred<unknown>();
    mocks.fetchBootstrap.mockReturnValueOnce(pageRead.promise);
    await act(async () => { void pullToRefresh(); });
    await flush();
    vi.mocked(router.replace).mockClear();
    mocks.owner = null;
    mocks.epoch = 2;
    await act(async () => { pageRead.reject(new authErrors.StaleMobileSessionResponseError()); });
    await flush();
    expect(router.replace).toHaveBeenCalledWith("/");
    expect(texts().join(" ")).not.toContain("Couldn't refresh");
  });
});
