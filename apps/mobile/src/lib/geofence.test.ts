import { beforeEach, describe, expect, it, vi } from "vitest";

const asyncStore = vi.hoisted(() => new Map<string, string>());
const secureStore = vi.hoisted(() => new Map<string, string>());
const runtimeMocks = vi.hoisted(() => ({
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
      name: "Tesco Springfield",
      street: "Springfield Road",
      city: "Chelmsford",
      postalCode: "CM2 6QT",
      formattedAddress: "Springfield Road, Chelmsford CM2 6QT"
    }
  ]))
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

const {
  LOCATION_VISIT_DWELL_THRESHOLD_MINUTES,
  evaluateGeofenceTransitionEvidence,
  getLocationVisitDiagnostics,
  recordLocationLearningSample,
  recordGeofenceTransition,
  refreshGeofencesForPlaces,
  setLocationLearningEnabled,
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
  beforeEach(() => {
    asyncStore.clear();
    secureStore.clear();
    vi.clearAllMocks();
  });

  it("rehydrates unchanged region state without repeatedly re-registering iOS geofences", async () => {
    await startGeofences([place]);
    await startGeofences([place]);

    expect(locationMocks.startGeofencingAsync).toHaveBeenCalledOnce();
    expect(locationMocks.startGeofencingAsync).toHaveBeenCalledWith(
      "DAYFRAME_GEOFENCE_TASK",
      [expect.objectContaining({ identifier: place.id, radius: place.radiusMeters })]
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
      lastStatus: "Queued Gym visit for review. Saved-place visits are review-first before becoming time entries."
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
        description: "Tesco Springfield"
      })
    );
    expect(locationMocks.reverseGeocodeAsync).toHaveBeenCalledWith({
      latitude: 51.61,
      longitude: -0.22
    });
    expect(learned?.rawPayload).toMatchObject({
      evidenceKind: "learned_place_visit",
      candidateName: "Tesco Springfield",
      address: expect.objectContaining({
        name: "Tesco Springfield",
        street: "Springfield Road",
        postalCode: "CM2 6QT"
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
      description: "Tesco Springfield",
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
          "Queued Gym visit for review. Saved-place visits are review-first before becoming time entries.",
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
