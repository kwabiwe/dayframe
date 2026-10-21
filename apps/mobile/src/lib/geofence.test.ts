import { beforeEach, describe, expect, it, vi } from "vitest";

const asyncStore = vi.hoisted(() => new Map<string, string>());
const secureStore = vi.hoisted(() => new Map<string, string>());
const runtimeMocks = vi.hoisted(() => ({
  isLocationLogoutCurrent: () => false,
  enableLocationCaptureOwnership: vi.fn(async () => {
    asyncStore.set("dayframe.location.learning.enabled.v1:account:https%3A%2F%2Fdayframe.test:workspace-geofence:user-geofence", "true");
    return true;
  }),
  stopUnownedLocationCapture: vi.fn(async () => undefined),
  endLocationCaptureOwnership: vi.fn(async () => undefined),
  locationCaptureAccountChanged: vi.fn(async () => undefined),
  locationCaptureSessionSignedOut: vi.fn(async () => undefined),
  withLocationCaptureLifecycle: (operation: () => Promise<unknown>) => operation(),
  startNativeLocationIntelligence: vi.fn(() => Promise.resolve({ enabled: true })),
  stopNativeLocationIntelligence: vi.fn(() => Promise.resolve({ enabled: false }))
}));
const locationMocks = vi.hoisted(() => ({
  startGeofencingAsync: vi.fn(() => Promise.resolve()),
  startLocationUpdatesAsync: vi.fn(() => Promise.resolve()),
  stopGeofencingAsync: vi.fn(() => Promise.resolve()),
  stopLocationUpdatesAsync: vi.fn(() => Promise.resolve()),
  hasStartedGeofencingAsync: vi.fn(() => Promise.resolve(true)),
  hasStartedLocationUpdatesAsync: vi.fn(() => Promise.resolve(false)),
  getForegroundPermissionsAsync: vi.fn(() => Promise.resolve({ status: "granted", granted: true })),
  getBackgroundPermissionsAsync: vi.fn(() => Promise.resolve({ status: "granted", granted: true })),
  getLastKnownPositionAsync: vi.fn<() => Promise<unknown>>(() => Promise.resolve(null)),
  requestForegroundPermissionsAsync: vi.fn(() => Promise.resolve({ status: "granted", granted: true })),
  requestBackgroundPermissionsAsync: vi.fn(() => Promise.resolve({ status: "granted", granted: true })),
  reverseGeocodeAsync: vi.fn(() => Promise.resolve([
    {
      name: "Example Grocer",
      street: "Example Road",
      city: "Exampleton",
      postalCode: "ZZ1 1AA",
      formattedAddress: "Example Road, Exampleton ZZ1 1AA"
    }
  ]))
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(asyncStore.get(key) ?? null)),
    removeItem: vi.fn(async (key: string) => { asyncStore.delete(key); }),
    setItem: vi.fn((key: string, value: string) => {
      asyncStore.set(key, value);
      return Promise.resolve();
    })
  }
}));

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
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

vi.mock("react-native", () => ({
  AppState: { currentState: "active" },
  NativeModules: {
    DayframeLiveActivityModule: {
      clearRuntimeContext: vi.fn(() => Promise.resolve(true)),
      setRuntimeContext: vi.fn(() => Promise.resolve(true))
    }
  },
  Platform: { OS: "ios" }
}));

vi.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  GeofencingEventType: { Enter: 1, Exit: 2 },
  ...locationMocks
}));

vi.mock("expo-task-manager", () => ({
  defineTask: vi.fn()
}));

vi.mock("./config", () => ({
  DAYFRAME_API_BASE: "https://dayframe.test"
}));

vi.mock("./location/runtime", () => runtimeMocks);
// These legacy classifier fixtures intentionally isolate the capture owner;
// real account/task/SQLite admission is exercised in ownership.sqlite.test.ts.
const captureState = vi.hoisted(() => ({ current: true }));
vi.mock("./location/store", () => ({
  captureLocationOwnership: async () => ({ revision: 0, binding: {id:"capture-test", enabled:true, boundAt:"2020-01-01T00:00:00Z"},
    context: {userId:"user-geofence",workspaceId:"workspace-geofence",savedPlaces:{some:()=>true}} }),
  updateLocationCaptureCatalogue: async () => true,
  getLocationRolloutMode: async () => "v1",
  hasLegacyLocationOwner: async () => true,
  isLocationCaptureSnapshotCurrent: () => captureState.current,
  locationCaptureRevision: () => 0
}));

const {
  LOCATION_VISIT_DWELL_THRESHOLD_MINUTES,
  evaluateGeofenceTransitionEvidence,
  getLocationVisitDiagnostics,
  recordLocationLearningSample,
  recordGeofenceTransition,
  refreshGeofencesForPlaces,
  setLocationLearningEnabled,
  startGeofences,
  locationAccessNeedsIosSettings,
  requestAlwaysLocationPermission,
  requestForegroundLocationPermission
} = await import("./geofence");
const { readQueue, syncQueue } = await import("./api");
const { __resetMobileAccountForTests, activateMobileAccount } = await import("./mobileAccount");

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
  defaultActivityDescription: "Workout",
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

const homePlace = {
  ...place,
  id: "30000000-0000-4000-8000-000000000001",
  name: "Home",
  latitude: 51.49,
  longitude: -0.11,
  defaultCategoryId: null,
  defaultCategoryName: null,
  defaultActivityDescription: null
};

const homeRegion = {
  identifier: homePlace.id,
  latitude: homePlace.latitude,
  longitude: homePlace.longitude,
  radius: homePlace.radiusMeters,
  notifyOnEnter: true,
  notifyOnExit: true
};

describe("mobile geofence visit candidates", () => {
  beforeEach(async () => {
    asyncStore.clear();
    secureStore.clear();
    vi.clearAllMocks();
    __resetMobileAccountForTests();
    await activateMobileAccount({ userId: "user-geofence", workspaceId: "workspace-geofence" });
    asyncStore.set("dayframe.location.learning.enabled.v1:account:https%3A%2F%2Fdayframe.test:workspace-geofence:user-geofence", "true");
  });

  it("rehydrates unchanged region state without repeatedly re-registering iOS geofences", async () => {
    await startGeofences([place]);
    await startGeofences([place]);

    expect(locationMocks.startGeofencingAsync).toHaveBeenCalledOnce();
    expect(locationMocks.startGeofencingAsync).toHaveBeenCalledWith(
      "DAYFRAME_GEOFENCE_TASK",
      [expect.objectContaining({ identifier: `capture-test:${place.id}`, radius: place.radiusMeters })]
    );
  });

  it("restarts native visit monitoring when enabled location learning rehydrates", async () => {
    asyncStore.set("dayframe.location.learning.enabled.v1", "true");

    await refreshGeofencesForPlaces([place]);

    expect(locationMocks.startLocationUpdatesAsync).toHaveBeenCalledOnce();
    expect(runtimeMocks.startNativeLocationIntelligence).toHaveBeenCalledOnce();
  });

  it("reports saved places excluded by the iOS twenty-region limit", async () => {
    const places = Array.from({ length: 22 }, (_, index) => ({
      ...place,
      id: `30000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
      name: `Place ${index + 1}`,
      priority: 100 - index
    }));

    await expect(startGeofences(places)).resolves.toBe(20);
    await expect(getLocationVisitDiagnostics()).resolves.toMatchObject({
      activeMonitorCount: 20,
      configuredMonitorCount: 22,
      excludedMonitorCount: 2,
      excludedPlaceNames: ["Place 21", "Place 22"],
      geofencingActive: true
    });
  });

  it("still matches place 21 from the full catalogue instead of relearning it", async () => {
    const places = Array.from({ length: 21 }, (_, index) => ({
      ...place,
      id: `30000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      name: `Place ${index + 1}`,
      latitude: 51.2 + index * 0.01,
      longitude: -0.3,
      priority: 100 - index
    }));
    const place21 = places[20];

    await startGeofences(places);
    await setLocationLearningEnabled(true, places);
    const result = await recordLocationLearningSample({
      coords: {
        latitude: place21.latitude,
        longitude: place21.longitude,
        altitude: null,
        accuracy: 15,
        altitudeAccuracy: null,
        heading: null,
        speed: null
      },
      timestamp: Date.parse("2026-07-20T12:00:00.000Z")
    }, places);

    expect(result).toMatchObject({ status: "saved_place", queued: false });
    await expect(getLocationVisitDiagnostics()).resolves.toMatchObject({
      excludedPlaceNames: ["Place 21"],
      lastStatus: "Location learning matched Place 21; noisy samples stay attached to saved places."
    });
    expect((await readQueue()).some((item) => item.type === "unknown_stay")).toBe(false);
  });

  it("rejects a false enter when a fresh accurate fix is clearly outside the saved radius", async () => {
    await startGeofences([place]);
    const occurredAt = new Date("2026-07-06T08:00:00.000Z");
    locationMocks.getLastKnownPositionAsync.mockResolvedValueOnce({
      coords: {
        latitude: 52.5,
        longitude: -0.12,
        altitude: null,
        accuracy: 10,
        altitudeAccuracy: null,
        heading: null,
        speed: null
      },
      timestamp: occurredAt.getTime()
    });

    const result = await recordGeofenceTransition("enter", region, occurredAt);
    const queue = await readQueue();
    const diagnostics = await getLocationVisitDiagnostics();

    expect(result).toEqual(expect.objectContaining({ status: "evidence_rejected_enter", queued: false }));
    expect(queue.some((item) => item.type === "geofence_enter")).toBe(false);
    expect(diagnostics.lastTransitionEvidence).toMatchObject({
      transition: "enter",
      placeName: "Gym",
      outcome: "rejected_far_from_region",
      configuredRadiusMeters: 100,
      accuracyMeters: 10
    });
  });

  it("does not reject an enter from a stale location fix", () => {
    expect(evaluateGeofenceTransitionEvidence({
      transition: "enter",
      placeName: "School",
      occurredAt: new Date("2026-07-06T08:02:00.000Z"),
      configuredRadiusMeters: 100,
      distanceMeters: 800,
      accuracyMeters: 10,
      sampleAgeMs: 2 * 60_000
    })).toMatchObject({ outcome: "no_recent_location" });
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
        description: "Workout"
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
    await expect(getLocationVisitDiagnostics()).resolves.toMatchObject({
      lastStatus: "Queued Gym visit for review. Saved-place visits are review-first before becoming blocks."
    });
  });

  it("does not queue a visit candidate below the dwell threshold", async () => {
    await startGeofences([place]);
    await recordGeofenceTransition("enter", region, new Date("2026-07-06T08:00:00.000Z"));
    const result = await recordGeofenceTransition("exit", region, new Date("2026-07-06T08:02:00.000Z"));

    const queue = await readQueue();
    const diagnostics = await getLocationVisitDiagnostics();

    expect(result).toEqual(expect.objectContaining({ status: "below_dwell_threshold", queued: false }));
    expect(queue.some((item) => item.type === "geofence_exit")).toBe(false);
    expect(diagnostics.lastGeofenceEvent).toEqual({
      transition: "exit",
      placeName: "Gym",
      occurredAt: "2026-07-06T08:02:00.000Z"
    });
    expect(diagnostics.lastQueuedVisitCandidate).toBeUndefined();
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
      defaultCategoryName: place.defaultCategoryName,
      defaultActivityDescription: "Workout",
      loggingEnabled: true
    });
  });

  it("does not queue saved-place visit reviews when logging is disabled for that place", async () => {
    await startGeofences([{ ...place, loggingEnabled: false }]);
    const enter = await recordGeofenceTransition("enter", region, new Date("2026-07-06T09:00:00.000Z"));
    const exit = await recordGeofenceTransition("exit", region, new Date("2026-07-06T09:10:00.000Z"));

    const queue = await readQueue();
    const diagnostics = await getLocationVisitDiagnostics();

    expect(enter).toEqual(expect.objectContaining({ status: "logging_disabled_enter", queued: false }));
    expect(exit).toEqual(expect.objectContaining({ status: "logging_disabled_visit", queued: false }));
    expect(queue.some((item) => item.type === "geofence_exit")).toBe(false);
    expect(diagnostics.lastStatus).toContain("visit logging is off");
  });

  it("falls back to the place name when no default activity description is set", async () => {
    const fallbackPlace = { ...place, defaultActivityDescription: null };
    await startGeofences([fallbackPlace]);
    await recordGeofenceTransition("enter", region, new Date("2026-07-06T09:30:00.000Z"));
    await recordGeofenceTransition("exit", region, new Date("2026-07-06T09:40:00.000Z"));

    const queue = await readQueue();
    const visit = queue.find((item) => item.type === "geofence_exit");

    expect(visit?.description).toBe("Gym");
    expect(visit?.rawPayload).toMatchObject({
      defaultActivityDescription: null
    });
  });

  it("describes a Work-role place as Work rather than its saved address", async () => {
    const workPlace = { ...place, name: "1 Office Street", role: "work" as const, defaultActivityDescription: null };
    await startGeofences([workPlace]);
    await recordGeofenceTransition("enter", region, new Date("2026-07-06T09:30:00.000Z"));
    await recordGeofenceTransition("exit", region, new Date("2026-07-06T09:40:00.000Z"));

    const queue = await readQueue();
    expect(queue.find((item) => item.type === "geofence_enter")?.description).toBe("Entered Work");
    const visit = queue.find((item) => item.type === "geofence_exit");
    expect(visit?.description).toBe("Work");
    expect(visit?.rawPayload).toMatchObject({ placeName: "Work" });
    expect((await getLocationVisitDiagnostics()).monitoredPlaceNames).toEqual(["Work"]);
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

  it("does not queue commute candidates until commute learning is enabled", async () => {
    await startGeofences([homePlace, place]);
    asyncStore.set("dayframe.location.learning.enabled.v1:account:https%3A%2F%2Fdayframe.test:workspace-geofence:user-geofence", "false");
    await recordGeofenceTransition("enter", homeRegion, new Date("2026-07-06T07:45:00.000Z"));
    await recordGeofenceTransition("exit", homeRegion, new Date("2026-07-06T08:00:00.000Z"));
    await recordGeofenceTransition("enter", region, new Date("2026-07-06T08:25:00.000Z"));
    await recordGeofenceTransition("exit", region, new Date("2026-07-06T08:40:00.000Z"));

    const queue = await readQueue();

    expect(queue.some((item) => item.type === "commute_detected")).toBe(false);
  });

  it("queues an auto-log commute candidate between consecutive saved-place visits when enabled", async () => {
    await setLocationLearningEnabled(true, [homePlace, place]);
    await startGeofences([homePlace, place]);
    await recordGeofenceTransition("enter", homeRegion, new Date("2026-07-06T07:45:00.000Z"));
    await recordGeofenceTransition("exit", homeRegion, new Date("2026-07-06T08:00:00.000Z"));
    await recordGeofenceTransition("enter", region, new Date("2026-07-06T08:25:00.000Z"));
    await recordGeofenceTransition("exit", region, new Date("2026-07-06T08:40:00.000Z"));

    const queue = await readQueue();
    const commute = queue.find((item) => item.type === "commute_detected");

    expect(commute).toEqual(
      expect.objectContaining({
        source: "location_learning"
      })
    );
    expect(commute?.description).toBeUndefined();
    expect(commute?.rawPayload).toMatchObject({
      evidenceKind: "commute_between_saved_place_visits",
      fromPlaceName: "Home",
      toPlaceName: "Gym",
      startedAt: "2026-07-06T08:00:00.000Z",
      stoppedAt: "2026-07-06T08:25:00.000Z",
      confidence: "medium_high",
      reviewFirst: false
    });
  });

  it("snaps nearby noisy location-learning samples to saved places instead of learning duplicates", async () => {
    const narrowHome = { ...homePlace, radiusMeters: 10 };
    await setLocationLearningEnabled(true, [narrowHome]);

    const result = await recordLocationLearningSample(
      {
        coords: {
          latitude: homePlace.latitude + 0.00018,
          longitude: homePlace.longitude,
          altitude: null,
          accuracy: 15,
          altitudeAccuracy: null,
          heading: null,
          speed: null
        },
        timestamp: new Date("2026-07-06T09:00:00.000Z").getTime()
      },
      [narrowHome]
    );

    const queue = await readQueue();
    const diagnostics = await getLocationVisitDiagnostics();

    expect(result).toEqual(expect.objectContaining({ status: "saved_place", queued: false }));
    expect(queue.some((item) => item.type === "learned_place_visit")).toBe(false);
    expect(diagnostics.lastStatus).toContain("matched Home");
  });

  it("keeps a weak one-visit cluster out of Learned places", async () => {
    await setLocationLearningEnabled(true, [place]);
    const baseSample = {
      coords: {
        latitude: 51.61,
        longitude: -0.22,
        altitude: null,
        accuracy: 35,
        altitudeAccuracy: null,
        heading: null,
        speed: null
      }
    };
    await recordLocationLearningSample(
      { ...baseSample, timestamp: new Date("2026-07-06T09:00:00.000Z").getTime() },
      [place]
    );
    await recordLocationLearningSample(
      { ...baseSample, timestamp: new Date("2026-07-06T09:08:00.000Z").getTime() },
      [place]
    );
    const weakResult = await recordLocationLearningSample(
      { ...baseSample, timestamp: new Date("2026-07-06T09:24:00.000Z").getTime() },
      [place]
    );

    let queue = await readQueue();
    expect(queue.some((item) => item.type === "learned_place_visit")).toBe(false);
    expect(queue.some((item) => item.rawPayload?.evidenceKind === "one_off_activity")).toBe(false);
    expect(weakResult).toMatchObject({
      queued: false,
      classification: { kind: "noise" }
    });
    expect(locationMocks.reverseGeocodeAsync).not.toHaveBeenCalled();

    await recordLocationLearningSample(
      { ...baseSample, timestamp: new Date("2026-07-07T09:00:00.000Z").getTime() },
      [place]
    );
    await recordLocationLearningSample(
      { ...baseSample, timestamp: new Date("2026-07-07T09:12:00.000Z").getTime() },
      [place]
    );
    const repeatedResult = await recordLocationLearningSample(
      { ...baseSample, timestamp: new Date("2026-07-07T09:25:00.000Z").getTime() },
      [place]
    );

    queue = await readQueue();
    const learned = queue.find((item) => item.type === "learned_place_visit");

    expect(repeatedResult).toMatchObject({
      queued: true,
      classification: { kind: "place_candidate" }
    });
    expect(learned).toEqual(
      expect.objectContaining({
        source: "location_learning",
        description: "Example Grocer"
      })
    );
    expect(locationMocks.reverseGeocodeAsync).toHaveBeenCalledWith({
      latitude: 51.61,
      longitude: -0.22
    });
    expect(learned?.rawPayload).toMatchObject({
      evidenceKind: "learned_place_visit",
      candidateName: "Example Grocer",
      address: expect.objectContaining({
        name: "Example Grocer",
        street: "Example Road",
        postalCode: "ZZ1 1AA"
      }),
      latitude: 51.61,
      longitude: -0.22,
      startedAt: "2026-07-07T09:00:00.000Z",
      stoppedAt: "2026-07-07T09:25:00.000Z",
      sampleCount: 6,
      distinctDayCount: 2,
      visitCount: 2,
      totalDwellMs: 49 * 60_000,
      longestDwellMs: 25 * 60_000,
      classification: "place_candidate",
      reviewFirst: true
    });
  });

  it("queues one long visit as a one-off activity instead of a learned place", async () => {
    await setLocationLearningEnabled(true, [place]);
    const baseSample = {
      coords: {
        latitude: 51.61,
        longitude: -0.22,
        altitude: null,
        accuracy: 30,
        altitudeAccuracy: null,
        heading: null,
        speed: null
      }
    };

    for (const minutes of [0, 15, 30, 45]) {
      await recordLocationLearningSample(
        { ...baseSample, timestamp: new Date(`2026-07-06T09:${String(minutes).padStart(2, "0")}:00.000Z`).getTime() },
        [place]
      );
    }
    const result = await recordLocationLearningSample(
      { ...baseSample, timestamp: new Date("2026-07-06T10:01:00.000Z").getTime() },
      [place]
    );

    const queue = await readQueue();
    const oneOff = queue.find((item) => item.rawPayload?.evidenceKind === "one_off_activity");

    expect(result).toMatchObject({
      status: "one_off_activity_queued",
      queued: true,
      classification: { kind: "one_off_activity" }
    });
    expect(queue.some((item) => item.type === "learned_place_visit")).toBe(false);
    expect(oneOff).toMatchObject({
      source: "location_learning",
      type: "unknown_stay",
      description: "Example Grocer",
      rawPayload: expect.objectContaining({
        classification: "one_off_activity",
        visitCount: 1,
        distinctDayCount: 1,
        sampleCount: 5,
        durationMinutes: 61
      })
    });
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
        lastStatus:
          "Queued Gym visit for review. Saved-place visits are review-first before becoming blocks.",
        lastPlaceName: "Gym",
        lastGeofenceEvent: {
          transition: "exit",
          placeName: "Gym",
          occurredAt: "2026-07-06T12:08:00.000Z"
        },
        lastQueuedVisitCandidate: {
          placeName: "Gym",
          startedAt: "2026-07-06T12:00:00.000Z",
          stoppedAt: "2026-07-06T12:08:00.000Z",
          queuedAt: "2026-07-06T12:08:00.000Z",
          durationSeconds: 480
        },
        lastVisitQueuedAt: "2026-07-06T12:08:00.000Z"
      })
    );
  });
});

describe("nearest-place geofences (location v3 PR 16b)", () => {
  // Synthetic places on a made-up grid around (10, 20); 0.001° of latitude is about 111 m.
  const nearbyPlace = (index: number, overrides: Record<string, unknown> = {}) => ({
    ...place,
    id: `30000000-0000-4000-8000-${String(index + 500).padStart(12, "0")}`,
    name: `Synthetic place ${index}`,
    latitude: 10 + index * 0.001,
    longitude: 20,
    priority: 100 - index,
    ...overrides
  });
  const phoneAt = (latitude: number, longitude = 20) => locationMocks.getLastKnownPositionAsync.mockResolvedValue({
    coords: { latitude, longitude, altitude: null, accuracy: 10, altitudeAccuracy: null, heading: null, speed: null },
    timestamp: Date.now()
  });
  const registered = (call = 0) =>
    (locationMocks.startGeofencingAsync.mock.calls[call] as unknown as [string, Array<{ identifier: string; radius: number; latitude: number }>])[1];

  beforeEach(async () => {
    asyncStore.clear();
    vi.clearAllMocks();
    locationMocks.getLastKnownPositionAsync.mockReset().mockResolvedValue(null);
    __resetMobileAccountForTests();
    await activateMobileAccount({ userId: "user-geofence", workspaceId: "workspace-geofence" });
    asyncStore.set("dayframe.location.learning.enabled.v1:account:https%3A%2F%2Fdayframe.test:workspace-geofence:user-geofence", "true");
  });

  it("keeps today's registration for twenty or fewer places, without reading where the phone is", async () => {
    const places = Array.from({ length: 20 }, (_, index) => nearbyPlace(index + 1, { priority: index }));
    phoneAt(10);

    await expect(startGeofences(places)).resolves.toBe(20);
    await startGeofences(places);

    expect(locationMocks.startGeofencingAsync).toHaveBeenCalledOnce();
    expect(registered().map((region) => region.identifier)).toEqual(
      [...places].reverse().map((item) => `capture-test:${item.id}`)
    );
    expect(locationMocks.getLastKnownPositionAsync).not.toHaveBeenCalled();
    await expect(getLocationVisitDiagnostics()).resolves.toMatchObject({
      activeMonitorCount: 20,
      configuredMonitorCount: 20,
      excludedMonitorCount: 0,
      geofenceSelection: "all",
      lastStatus: "Monitoring 20 saved places."
    });
  });

  it("above twenty, watches Home, Work and the nearest places plus a refresh circle around the phone", async () => {
    const home = nearbyPlace(90, { role: "home", name: "1 Synthetic Road", latitude: 11 });
    const work = nearbyPlace(91, { role: "work", name: "2 Synthetic Road", latitude: 12 });
    const others = Array.from({ length: 25 }, (_, index) => nearbyPlace(index + 1));
    phoneAt(10.0255); // just past place 25 of the grid: places 9–25 are the nearest others

    await expect(startGeofences([...others, home, work])).resolves.toBe(19);

    const regions = registered();
    expect(regions).toHaveLength(20);
    const placeIds = regions.slice(0, 19).map((region) => region.identifier);
    expect(placeIds).toEqual([...placeIds].sort());
    expect(placeIds).toContain(`capture-test:${home.id}`);
    expect(placeIds).toContain(`capture-test:${work.id}`);
    expect(placeIds).toContain(`capture-test:${others[24].id}`);
    expect(placeIds).not.toContain(`capture-test:${others[0].id}`);
    expect(regions[19]).toMatchObject({ identifier: "capture-test:nearest-refresh", latitude: 10.0255, longitude: 20 });
    expect(regions[19].radius).toBeGreaterThanOrEqual(500);

    const diagnostics = await getLocationVisitDiagnostics();
    expect(diagnostics).toMatchObject({
      activeMonitorCount: 19,
      configuredMonitorCount: 27,
      excludedMonitorCount: 8,
      geofenceSelection: "nearest",
      lastStatus: "Watching 19 of 27 saved places: Home and Work, then the nearest to you. Places farther away are watched when you get closer."
    });
    expect(diagnostics.monitoredPlaceNames).toEqual(expect.arrayContaining(["Home", "Work", "Synthetic place 25"]));
    // Counts and names only: where the phone is never reaches diagnostics.
    expect(JSON.stringify(diagnostics)).not.toContain("10.0255");
  });

  it("re-registers only when the watched set changes or the phone leaves the refresh circle", async () => {
    const places = Array.from({ length: 30 }, (_, index) => nearbyPlace(index + 1));
    phoneAt(10.001);
    await startGeofences(places);
    // A few metres on, inside the circle, with the same nearest places: iOS keeps its registration.
    phoneAt(10.0012);
    await startGeofences(places);
    expect(locationMocks.startGeofencingAsync).toHaveBeenCalledOnce();

    // Far up the grid the nearest places differ.
    phoneAt(10.03);
    await startGeofences(places);
    expect(locationMocks.startGeofencingAsync).toHaveBeenCalledTimes(2);
    expect(registered(1).map((region) => region.identifier)).toContain(`capture-test:${places[29].id}`);
    expect(registered(1).at(-1)).toMatchObject({ identifier: "capture-test:nearest-refresh", latitude: 10.03 });
  });

  it("keeps the current circle's set when the position is unknown later, rather than reverting to priority", async () => {
    const places = Array.from({ length: 30 }, (_, index) => nearbyPlace(index + 1));
    phoneAt(10.03);
    await startGeofences(places);
    locationMocks.getLastKnownPositionAsync.mockResolvedValue(null);
    await startGeofences(places);
    expect(locationMocks.startGeofencingAsync).toHaveBeenCalledOnce();
    expect((await getLocationVisitDiagnostics()).geofenceSelection).toBe("nearest");
  });

  it("words the priority fallback honestly when the phone has never known where it is", async () => {
    const places = Array.from({ length: 22 }, (_, index) => nearbyPlace(index + 1));
    await expect(startGeofences(places)).resolves.toBe(20);
    expect(registered().some((region) => region.identifier.endsWith(":nearest-refresh"))).toBe(false);
    await expect(getLocationVisitDiagnostics()).resolves.toMatchObject({
      geofenceSelection: "priority",
      lastStatus: "Watching 20 of 22 saved places by priority until Dayframe knows where you are; then the nearest are watched."
    });
  });

  it("never treats the refresh circle as a saved place in the legacy classifier", async () => {
    await startGeofences([place]);
    const result = await recordGeofenceTransition("exit", { ...region, identifier: "nearest-refresh" }, new Date("2026-07-06T12:00:00.000Z"));
    expect(result).toMatchObject({ status: "unknown_place", queued: false });
    expect(await readQueue()).toEqual([]);
  });
});

describe("location access that needs iOS Settings (UIA-111)", () => {
  it("is true only when iOS won't ask again", async () => {
    const cases: Array<[unknown, unknown, boolean]> = [
      [{ status: "denied", granted: false, canAskAgain: false }, null, true],
      [{ status: "denied", granted: false, canAskAgain: true }, null, false],
      [{ status: "undetermined", granted: false, canAskAgain: true }, null, false],
      [{ status: "granted", granted: true }, { status: "denied", granted: false, canAskAgain: false }, true],
      [{ status: "granted", granted: true }, { status: "denied", granted: false, canAskAgain: true }, false],
      [{ status: "granted", granted: true }, { status: "granted", granted: true }, false],
    ];
    for (const [foreground, background, expected] of cases) {
      locationMocks.getForegroundPermissionsAsync.mockResolvedValueOnce(foreground as never);
      if (background) locationMocks.getBackgroundPermissionsAsync.mockResolvedValueOnce(background as never);
      expect(await locationAccessNeedsIosSettings()).toBe(expected);
    }
  });
});

describe("Always already asked, after a restart (UIA-111, Codex r3–r4)", () => {
  // Each case starts with no request history on this iPhone (Codex r6: no inherited "asked").
  beforeEach(() => {
    asyncStore.delete("dayframe.location.alwaysRequest.v2");
  });
  const fg = (status: string) => locationMocks.getForegroundPermissionsAsync.mockResolvedValueOnce(
    (status === "granted" ? { status, granted: true } : { status, granted: false, canAskAgain: true }) as never
  );
  const bgUndetermined = () => locationMocks.getBackgroundPermissionsAsync.mockResolvedValueOnce({ status: "undetermined", granted: false, canAskAgain: true } as never);

  it("routes to iOS Settings once the one Always prompt was used, declined or later downgraded", async () => {
    locationMocks.requestBackgroundPermissionsAsync.mockResolvedValueOnce({ status: "denied", granted: false, canAskAgain: true } as never);
    await requestAlwaysLocationPermission();
    fg("granted"); bgUndetermined(); // cold restart after declining
    expect(await locationAccessNeedsIosSettings()).toBe(true);
    // Granted, then downgraded to While Using in iOS Settings, then a restart.
    locationMocks.requestBackgroundPermissionsAsync.mockResolvedValueOnce({ status: "granted", granted: true } as never);
    await requestAlwaysLocationPermission();
    fg("granted"); bgUndetermined();
    expect(await locationAccessNeedsIosSettings()).toBe(true);
  });

  it("forgets an Always request made under an Allow Once grant once that grant expires", async () => {
    locationMocks.requestBackgroundPermissionsAsync.mockResolvedValueOnce({ status: "denied", granted: false, canAskAgain: true } as never);
    await requestAlwaysLocationPermission(); // failed silently under Allow Once
    fg("undetermined"); // the temporary grant expired
    expect(await locationAccessNeedsIosSettings()).toBe(false);
    fg("granted"); bgUndetermined(); // a permanent While Using grant later
    expect(await locationAccessNeedsIosSettings()).toBe(false);
  });

  it("clears that record when the next While Using grant comes from onboarding or Places, before any check (Codex r5)", async () => {
    locationMocks.requestBackgroundPermissionsAsync.mockResolvedValueOnce({ status: "denied", granted: false, canAskAgain: true } as never);
    await requestAlwaysLocationPermission(); // failed silently under Allow Once
    // The grant expired; the next request (onboarding, Places) renews it as While Using.
    fg("undetermined");
    locationMocks.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: "granted", granted: true } as never);
    await requestForegroundLocationPermission();
    fg("granted"); bgUndetermined();
    expect(await locationAccessNeedsIosSettings()).toBe(false);
  });

  it("an Always grant from an older build counts as the used prompt once seen (Codex r5)", async () => {
    // Always was granted before this build kept a record; Location's status is read once.
    fg("granted");
    locationMocks.getBackgroundPermissionsAsync.mockResolvedValueOnce({ status: "granted", granted: true } as never);
    expect(await locationAccessNeedsIosSettings()).toBe(false);
    // Downgraded to While Using in iOS Settings, then a restart: iOS will not ask again.
    fg("granted"); bgUndetermined();
    expect(await locationAccessNeedsIosSettings()).toBe(true);
  });

  it("the geofence refresh on an ordinary launch records a seen Always grant (Codex r6)", async () => {
    locationMocks.getForegroundPermissionsAsync.mockResolvedValue({ status: "granted", granted: true } as never);
    locationMocks.getBackgroundPermissionsAsync.mockResolvedValue({ status: "granted", granted: true } as never);
    await refreshGeofencesForPlaces([place]);
    locationMocks.getForegroundPermissionsAsync.mockReset();
    locationMocks.getBackgroundPermissionsAsync.mockReset();
    fg("granted"); bgUndetermined(); // downgraded to While Using, then a restart
    expect(await locationAccessNeedsIosSettings()).toBe(true);
  });

  it("an ordinary launch records a seen Always grant even with suggestions off (Codex r7)", async () => {
    captureState.current = false; // suggestions off: no enabled capture binding
    try {
      locationMocks.getForegroundPermissionsAsync.mockResolvedValue({ status: "granted", granted: true } as never);
      locationMocks.getBackgroundPermissionsAsync.mockResolvedValue({ status: "granted", granted: true } as never);
      await refreshGeofencesForPlaces([place]).catch(() => undefined);
      await vi.waitFor(() => expect(asyncStore.get("dayframe.location.alwaysRequest.v2")).toBe("asked"));
    } finally {
      captureState.current = true;
    }
    locationMocks.getForegroundPermissionsAsync.mockReset();
    locationMocks.getBackgroundPermissionsAsync.mockReset();
    fg("granted"); bgUndetermined();
    expect(await locationAccessNeedsIosSettings()).toBe(true);
  });

  it("in the same process, a renewed grant after Allow Once still routes to Settings: Expo won't ask twice (Codex r6)", async () => {
    // expo-location's requester remembers it asked (until the app restarts) and then reports Always
    // denied and not askable, so a request would show nothing: iOS Settings is the only way.
    locationMocks.requestBackgroundPermissionsAsync.mockResolvedValueOnce({ status: "denied", granted: false, canAskAgain: true } as never);
    await requestAlwaysLocationPermission(); // failed silently under Allow Once
    fg("undetermined");
    locationMocks.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: "granted", granted: true } as never);
    await requestForegroundLocationPermission(); // our record is cleared
    fg("granted");
    locationMocks.getBackgroundPermissionsAsync.mockResolvedValueOnce({ status: "denied", granted: false, canAskAgain: false } as never);
    expect(await locationAccessNeedsIosSettings()).toBe(true);
  });

  it("the diagnostics read records a seen Always grant too", async () => {
    locationMocks.getForegroundPermissionsAsync.mockResolvedValueOnce({ status: "granted", granted: true } as never);
    locationMocks.getBackgroundPermissionsAsync.mockResolvedValueOnce({ status: "granted", granted: true } as never);
    await getLocationVisitDiagnostics();
    fg("granted"); bgUndetermined();
    expect(await locationAccessNeedsIosSettings()).toBe(true);
  });
});
