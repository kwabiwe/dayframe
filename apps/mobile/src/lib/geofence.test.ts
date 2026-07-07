import { beforeEach, describe, expect, it, vi } from "vitest";

const asyncStore = vi.hoisted(() => new Map<string, string>());
const secureStore = vi.hoisted(() => new Map<string, string>());
const locationMocks = vi.hoisted(() => ({
  startGeofencingAsync: vi.fn(() => Promise.resolve()),
  stopGeofencingAsync: vi.fn(() => Promise.resolve()),
  hasStartedGeofencingAsync: vi.fn(() => Promise.resolve(false)),
  getForegroundPermissionsAsync: vi.fn(() => Promise.resolve({ status: "granted", granted: true })),
  getBackgroundPermissionsAsync: vi.fn(() => Promise.resolve({ status: "granted", granted: true })),
  requestForegroundPermissionsAsync: vi.fn(() => Promise.resolve({ status: "granted", granted: true })),
  requestBackgroundPermissionsAsync: vi.fn(() => Promise.resolve({ status: "granted", granted: true }))
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(asyncStore.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      asyncStore.set(key, value);
      return Promise.resolve();
    })
  }
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn((key: string) => Promise.resolve(secureStore.get(key) ?? null)),
  setItemAsync: vi.fn((key: string, value: string) => {
    secureStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: vi.fn((key: string) => {
    secureStore.delete(key);
    return Promise.resolve();
  })
}));

vi.mock("expo-location", () => ({
  GeofencingEventType: { Enter: 1, Exit: 2 },
  ...locationMocks
}));

vi.mock("expo-task-manager", () => ({
  defineTask: vi.fn()
}));

vi.mock("./config", () => ({
  DAYFRAME_API_BASE: "https://dayframe.test"
}));

const {
  LOCATION_VISIT_DWELL_THRESHOLD_MINUTES,
  getLocationVisitDiagnostics,
  recordGeofenceTransition,
  startGeofences
} = await import("./geofence");
const { readQueue, syncQueue } = await import("./api");

const place = {
  id: "30000000-0000-4000-8000-000000000003",
  name: "Gym",
  latitude: 51.5,
  longitude: -0.12,
  radiusMeters: 100,
  priority: 8,
  defaultProjectId: null,
  defaultCategoryId: "20000000-0000-4000-8000-000000000004",
  defaultCategoryName: "Fitness",
  autoStart: false
};

const region = {
  identifier: place.id,
  latitude: place.latitude,
  longitude: place.longitude,
  radius: place.radiusMeters,
  notifyOnEnter: true,
  notifyOnExit: true
};

describe("mobile geofence visit candidates", () => {
  beforeEach(() => {
    asyncStore.clear();
    secureStore.clear();
    vi.clearAllMocks();
  });

  it("queues a review-safe visit candidate from an enter/exit pair", async () => {
    await startGeofences([place]);
    await recordGeofenceTransition("enter", region, new Date("2026-07-06T08:00:00.000Z"));
    const result = await recordGeofenceTransition("exit", region, new Date("2026-07-06T08:12:00.000Z"));

    const queue = await readQueue();
    const visit = queue.find((item) => item.type === "geofence_exit");

    expect(result).toEqual(expect.objectContaining({ status: "visit_queued", queued: true }));
    expect(visit).toEqual(
      expect.objectContaining({
        localId: `location-visit-${place.id}-1783324800000`,
        source: "geofence_specific",
        type: "geofence_exit",
        placeId: place.id,
        categoryId: place.defaultCategoryId,
        description: "Visit to Gym"
      })
    );
    expect(visit?.rawPayload).toMatchObject({
      evidenceKind: "known_place_visit",
      placeId: place.id,
      placeName: "Gym",
      startedAt: "2026-07-06T08:00:00.000Z",
      stoppedAt: "2026-07-06T08:12:00.000Z",
      durationSeconds: 720,
      confidence: "medium_high",
      source: "ios_geofence"
    });
  });

  it("does not queue a visit candidate below the dwell threshold", async () => {
    await startGeofences([place]);
    await recordGeofenceTransition("enter", region, new Date("2026-07-06T08:00:00.000Z"));
    const result = await recordGeofenceTransition("exit", region, new Date("2026-07-06T08:02:00.000Z"));

    const queue = await readQueue();

    expect(result).toEqual(expect.objectContaining({ status: "below_dwell_threshold", queued: false }));
    expect(queue.some((item) => item.type === "geofence_exit")).toBe(false);
    expect(LOCATION_VISIT_DWELL_THRESHOLD_MINUTES).toBe(5);
  });

  it("includes the known place default category in the visit candidate", async () => {
    await startGeofences([place]);
    await recordGeofenceTransition("enter", region, new Date("2026-07-06T09:00:00.000Z"));
    await recordGeofenceTransition("exit", region, new Date("2026-07-06T09:10:00.000Z"));

    const queue = await readQueue();
    const visit = queue.find((item) => item.type === "geofence_exit");

    expect(visit?.categoryId).toBe(place.defaultCategoryId);
    expect(visit?.rawPayload).toMatchObject({
      defaultCategoryId: place.defaultCategoryId,
      defaultCategoryName: place.defaultCategoryName
    });
  });

  it("dedupes repeated geofence events for the same visit", async () => {
    await startGeofences([place]);
    await recordGeofenceTransition("enter", region, new Date("2026-07-06T10:00:00.000Z"));
    await recordGeofenceTransition("enter", region, new Date("2026-07-06T10:01:00.000Z"));
    await recordGeofenceTransition("exit", region, new Date("2026-07-06T10:10:00.000Z"));
    await recordGeofenceTransition("exit", region, new Date("2026-07-06T10:11:00.000Z"));

    const queue = await readQueue();

    expect(queue.filter((item) => item.type === "geofence_enter")).toHaveLength(1);
    expect(queue.filter((item) => item.type === "geofence_exit")).toHaveLength(1);
  });

  it("keeps queued visit candidates offline when sync fails", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    await startGeofences([place]);
    await recordGeofenceTransition("enter", region, new Date("2026-07-06T11:00:00.000Z"));
    await recordGeofenceTransition("exit", region, new Date("2026-07-06T11:20:00.000Z"));
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Network request failed"))));

    const result = await syncQueue();
    const persisted = await readQueue();

    expect(result.syncedCount).toBe(0);
    expect(result.remaining.some((item) => item.type === "geofence_exit")).toBe(true);
    expect(persisted.some((item) => item.type === "geofence_exit")).toBe(true);
  });

  it("reports monitor count and last visit status for diagnostics", async () => {
    await startGeofences([place]);
    await recordGeofenceTransition("enter", region, new Date("2026-07-06T12:00:00.000Z"));
    await recordGeofenceTransition("exit", region, new Date("2026-07-06T12:08:00.000Z"));

    const diagnostics = await getLocationVisitDiagnostics();

    expect(diagnostics).toEqual(
      expect.objectContaining({
        foregroundPermission: "granted",
        backgroundPermission: "granted",
        activeMonitorCount: 1,
        lastStatus: "Queued Gym visit for review.",
        lastPlaceName: "Gym",
        lastVisitQueuedAt: "2026-07-06T12:08:00.000Z"
      })
    );
  });
});
