import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
const captureDb = new DatabaseSync(":memory:");
vi.mock("expo-crypto",()=>({CryptoDigestAlgorithm:{SHA256:"sha256"},digestStringAsync:async (_algorithm:string,value:string)=>createHash("sha256").update(value).digest("hex")}));
vi.mock("expo-sqlite",()=>({openDatabaseAsync:async()=>{
  const adapter={
    execAsync:async(sql:string)=>{captureDb.exec(sql);},
    getFirstAsync:async(sql:string,...args:never[])=>captureDb.prepare(sql).get(...args)??null,
    getAllAsync:async(sql:string,...args:never[])=>captureDb.prepare(sql).all(...args),
    runAsync:async(sql:string,...args:never[])=>captureDb.prepare(sql).run(...args),
    withExclusiveTransactionAsync:async(work:(transaction:unknown)=>Promise<void>)=>{
      captureDb.exec("begin immediate");try{await work(adapter);captureDb.exec("commit");}catch(error){captureDb.exec("rollback");throw error;}
    }
  };return adapter;
}}));
vi.mock("./backendIdentity",()=>({requireBackendIdentity:()=>"staging-fixture"}));
vi.mock("./secure-session",()=>({readOwnedAuthenticatedSessionSnapshot:async()=>({status:"authenticated",snapshot:{}}),isAuthenticatedSessionSnapshotCurrent:()=>true}));
afterAll(()=>captureDb.close());
afterEach(()=>vi.useRealTimers());

const asyncStore = vi.hoisted(() => new Map<string, string>());
const apiMocks = vi.hoisted(() => ({
  enqueueEvent: vi.fn(),
  reprocessHealthReviewItems: vi.fn()
}));
const healthkitMocks = vi.hoisted(() => ({
  configureBackgroundTypes: vi.fn(() => Promise.resolve(true)),
  enableBackgroundDelivery: vi.fn(() => Promise.resolve(true)),
  isHealthDataAvailable: vi.fn(() => true),
  queryCategorySamplesWithAnchor: vi.fn(),
  queryWorkoutSamplesWithAnchor: vi.fn(),
  requestAuthorization: vi.fn(() => true),
  subscribeToChanges: vi.fn()
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" }
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(asyncStore.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      asyncStore.set(key, value);
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      asyncStore.delete(key);
      return Promise.resolve();
    })
  }
}));

vi.mock("./mobileAccount", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mobileAccount")>();
  return {
    ...actual,
    readActiveMobileAccount: async () => ({ userId: "health-user", workspaceId: "health-workspace" }),
  };
});
vi.mock("./mobile-network", () => ({StaleMobileSessionResponseError: class extends Error {}}));

vi.mock("./api", () => ({
  enqueueEvent: apiMocks.enqueueEvent,
  reprocessHealthReviewItems: apiMocks.reprocessHealthReviewItems
}));

vi.mock("@kingstinct/react-native-healthkit", () => ({
  configureBackgroundTypes: healthkitMocks.configureBackgroundTypes,
  enableBackgroundDelivery: healthkitMocks.enableBackgroundDelivery,
  isHealthDataAvailable: healthkitMocks.isHealthDataAvailable,
  queryCategorySamplesWithAnchor: healthkitMocks.queryCategorySamplesWithAnchor,
  queryWorkoutSamplesWithAnchor: healthkitMocks.queryWorkoutSamplesWithAnchor,
  requestAuthorization: healthkitMocks.requestAuthorization,
  subscribeToChanges: healthkitMocks.subscribeToChanges
}));

const {
  getHealthAutoLogMappings,
  getHealthImportPreferences,
  getHealthWorkoutImportPreferences,
  groupSleepSamplesIntoSessions,
  healthKitSleepSessionEvent,
  healthKitWorkoutEvent,
  importHealthKitSleep,
  importHealthKitWorkouts,
  configureHealthKitAutomaticSync,
  mapHealthKitSleepSample,
  mapHealthKitWorkoutSample,
  exportHealthDebugSnapshot,
  isHealthKitAutomaticSyncEnabled,
  reprocessExistingHealthReviewItems,
  requestHealthKitPermissions,
  setHealthAutoLogMapping,
  setHealthImportPreference,
  startHealthKitChangeObservers
} = await import("./health");

describe("HealthKit mapping", () => {
  beforeEach(async () => {
    await import("@kingstinct/react-native-healthkit");
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-07-08T12:00:00.000Z"));
    for(const row of captureDb.prepare("select name from sqlite_master where type='table' and name like 'health_%'").all()) captureDb.exec(`delete from ${row.name}`);
    asyncStore.clear();
    apiMocks.enqueueEvent.mockReset();
    apiMocks.reprocessHealthReviewItems.mockReset();
    healthkitMocks.configureBackgroundTypes.mockReset();
    healthkitMocks.configureBackgroundTypes.mockResolvedValue(true);
    healthkitMocks.enableBackgroundDelivery.mockReset();
    healthkitMocks.enableBackgroundDelivery.mockResolvedValue(true);
    healthkitMocks.isHealthDataAvailable.mockReset();
    healthkitMocks.isHealthDataAvailable.mockReturnValue(true);
    healthkitMocks.queryCategorySamplesWithAnchor.mockReset();
    healthkitMocks.queryWorkoutSamplesWithAnchor.mockReset();
    healthkitMocks.requestAuthorization.mockReset();
    healthkitMocks.requestAuthorization.mockReturnValue(true);
    healthkitMocks.subscribeToChanges.mockReset();
    healthkitMocks.subscribeToChanges.mockImplementation(() => ({ remove: vi.fn() }));
  });

  it("maps sleep samples into Dayframe sleep segments", () => {
    const mapped = mapHealthKitSleepSample({
      uuid: "sleep-1",
      value: 3,
      startDate: "2026-07-03T22:00:00.000Z",
      endDate: "2026-07-04T06:00:00.000Z",
      sourceRevision: { source: { name: "Health" } }
    });

    expect(mapped).toMatchObject({
      externalSampleId: "sleep-1",
      stage: "asleep_core",
      startedAt: "2026-07-03T22:00:00.000Z",
      stoppedAt: "2026-07-04T06:00:00.000Z",
      sourceName: "Health"
    });
  });

  it("groups sleep phases into one user-facing sleep session", () => {
    const samples = [
      sleepSample("in-bed", "in_bed", "2026-07-06T22:30:00.000Z", "2026-07-06T23:55:00.000Z"),
      sleepSample("core", "asleep_core", "2026-07-06T23:55:00.000Z", "2026-07-07T02:15:00.000Z"),
      sleepSample("deep", "asleep_deep", "2026-07-07T02:15:00.000Z", "2026-07-07T03:10:00.000Z"),
      sleepSample("rem", "asleep_rem", "2026-07-07T03:10:00.000Z", "2026-07-07T06:27:00.000Z"),
      sleepSample("awake", "awake", "2026-07-07T06:27:00.000Z", "2026-07-07T06:40:00.000Z")
    ];

    const sessions = groupSleepSamplesIntoSessions(samples);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      startedAt: "2026-07-06T23:55:00.000Z",
      stoppedAt: "2026-07-07T06:27:00.000Z",
      samples: [
        expect.objectContaining({ externalSampleId: "core" }),
        expect.objectContaining({ externalSampleId: "deep" }),
        expect.objectContaining({ externalSampleId: "rem" })
      ]
    });
    expect(healthKitSleepSessionEvent(sessions[0])).toMatchObject({
      localId: expect.stringMatching(/^healthkit-sleep:sleep-session-/),
      description: "Sleep",
      rawPayload: {
        startedAt: "2026-07-06T23:55:00.000Z",
        stoppedAt: "2026-07-07T06:27:00.000Z",
        durationSeconds: 23520,
        autoConfirm: true,
        samples: expect.arrayContaining([
          expect.objectContaining({ sleepStage: "asleep_core" }),
          expect.objectContaining({ sleepStage: "asleep_deep" }),
          expect.objectContaining({ sleepStage: "asleep_rem" })
        ])
      }
    });
  });

  it("keeps different Health sources as separate sessions", () => {
    const watch = sleepSample(
      "watch-core",
      "asleep_core",
      "2026-07-31T22:53:00.000Z",
      "2026-08-01T05:51:00.000Z"
    );
    const phone = {
      ...sleepSample(
        "phone-core",
        "asleep_core",
        "2026-07-31T22:57:00.000Z",
        "2026-08-01T05:30:00.000Z"
      ),
      sourceName: "iPhone"
    };

    expect(groupSleepSamplesIntoSessions([watch, phone])).toHaveLength(2);
  });

  it("preserves split sleep beyond the canonical waking-gap boundary", () => {
    const first = sleepSample(
      "first",
      "asleep_core",
      "2026-07-31T21:00:00.000Z",
      "2026-08-01T00:00:00.000Z"
    );
    const atBoundary = sleepSample(
      "at-boundary",
      "asleep_rem",
      "2026-08-01T01:30:00.000Z",
      "2026-08-01T02:00:00.000Z"
    );
    const beyondBoundary = sleepSample(
      "beyond-boundary",
      "asleep_rem",
      "2026-08-01T01:30:00.001Z",
      "2026-08-01T02:00:00.000Z"
    );

    expect(groupSleepSamplesIntoSessions([first, atBoundary])).toHaveLength(1);
    expect(groupSleepSamplesIntoSessions([first, beyondBoundary])).toHaveLength(2);
  });

  it("imports sleep phases as one queued sleep session", async () => {
    healthkitMocks.queryCategorySamplesWithAnchor.mockResolvedValueOnce({
      newAnchor: "sleep-anchor-1", deletedSamples: [],
      samples: [
        { uuid: "core", value: 3, startDate: "2026-07-06T23:55:00.000Z", endDate: "2026-07-07T02:15:00.000Z" },
        { uuid: "deep", value: 4, startDate: "2026-07-07T02:15:00.000Z", endDate: "2026-07-07T03:10:00.000Z" },
        { uuid: "rem", value: 5, startDate: "2026-07-07T03:10:00.000Z", endDate: "2026-07-07T06:27:00.000Z" }
      ]
    });

    const result = await importHealthKitSleep();

    expect(result.importedCount).toBe(1);
    expect(apiMocks.enqueueEvent).toHaveBeenCalledTimes(1);
    expect(apiMocks.enqueueEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Sleep",
        rawPayload: expect.objectContaining({
          startedAt: "2026-07-06T23:55:00.000Z",
          stoppedAt: "2026-07-07T06:27:00.000Z",
          autoConfirm: true,
          samples: expect.arrayContaining([
            expect.objectContaining({ externalSampleId: "core" }),
            expect.objectContaining({ externalSampleId: "deep" }),
            expect.objectContaining({ externalSampleId: "rem" })
          ])
        })
      })
    );
  });

  it("keeps the early phase when a later delta revises the same Sleep episode",async()=>{
    const core={uuid:"core",value:3,startDate:"2026-07-06T23:55:00.000Z",endDate:"2026-07-07T02:15:00.000Z"};
    const rem={uuid:"rem",value:5,startDate:"2026-07-07T02:15:00.000Z",endDate:"2026-07-07T06:27:00.000Z"};
    healthkitMocks.queryCategorySamplesWithAnchor.mockResolvedValueOnce({newAnchor:"first",samples:[core],deletedSamples:[]})
      .mockResolvedValueOnce({newAnchor:"second",samples:[rem],deletedSamples:[]});
    await importHealthKitSleep();const first=apiMocks.enqueueEvent.mock.calls[0][0];
    await importHealthKitSleep();const second=apiMocks.enqueueEvent.mock.calls[1][0];
    expect(second.rawPayload.samples.map((sample:{externalSampleId:string})=>sample.externalSampleId)).toEqual(["core","rem"]);
    expect(second.localId).not.toBe(first.localId);
    expect(first.rawPayload.samples).toHaveLength(1);
    expect(healthkitMocks.queryCategorySamplesWithAnchor.mock.calls[1][1].anchor).toBe("first");
    expect(asyncStore.has("dayframe.healthkit.sleepAnchor.v1")).toBe(false);
  });


  it("journals an older anchored change before advancing the checkpoint", async () => {
    healthkitMocks.queryCategorySamplesWithAnchor.mockResolvedValueOnce({newAnchor:"old-change",deletedSamples:[],samples:[
      {uuid:"older-phase",value:3,startDate:"2026-06-01T00:00:00.000Z",endDate:"2026-06-01T07:00:00.000Z"}
    ]});
    const result = await importHealthKitSleep();
    expect(result.capturedCount).toBe(1);
    expect(apiMocks.enqueueEvent).toHaveBeenCalledOnce();
    expect(apiMocks.enqueueEvent.mock.calls[0][0].rawPayload.samples[0].externalSampleId).toBe("older-phase");
    expect(captureDb.prepare("select anchor from health_checkpoints").get()?.anchor).toBe("old-change");
    expect(captureDb.prepare("select sample_json from health_samples where sample_id='older-phase'").get()?.sample_json).toBeTruthy();
  });

  it("continues a full native page from its saved anchor before reporting complete capture",async()=>{
    const first=Array.from({length:250},(_,index)=>({uuid:`phase-${index}`,value:3,startDate:"2026-07-06T23:55:00.000Z",endDate:"2026-07-07T02:15:00.000Z"}));
    healthkitMocks.queryCategorySamplesWithAnchor.mockResolvedValueOnce({newAnchor:"page-1",samples:first,deletedSamples:[]})
      .mockResolvedValueOnce({newAnchor:"page-2",samples:[],deletedSamples:[]});
    const result=await importHealthKitSleep();
    expect(result).toMatchObject({capturedCount:250,partial:false,status:"queued"});
    expect(healthkitMocks.queryCategorySamplesWithAnchor.mock.calls[1][1]).toMatchObject({anchor:"page-1",limit:250});
    expect(apiMocks.enqueueEvent).toHaveBeenCalledTimes(1);
  });

  it("persists a successful workout while the independent sleep query fails",async()=>{
    healthkitMocks.queryCategorySamplesWithAnchor.mockRejectedValueOnce(new Error("native query fixture"));
    healthkitMocks.queryWorkoutSamplesWithAnchor.mockResolvedValueOnce({newAnchor:"workout",deletedSamples:[],workouts:[{
      uuid:"walk",workoutActivityType:52,startDate:"2026-07-07T08:00:00.000Z",endDate:"2026-07-07T09:00:00.000Z",duration:3600
    }]});
    const results=await Promise.allSettled([importHealthKitSleep(),importHealthKitWorkouts()]);
    expect(captureDb.prepare("select kind,usable,generated,ignored,outcome from health_query_runs order by kind").all()).toMatchObject([{kind:"sleep",outcome:"query_failed"},{kind:"workout",usable:1,generated:1}]);
    expect(results[0].status).toBe("rejected");expect(results[1]).toMatchObject({status:"fulfilled",value:{status:"queued"}});
    expect(apiMocks.enqueueEvent).toHaveBeenCalledTimes(1);
    expect(captureDb.prepare("select kind,outcome from health_query_runs order by kind").all()).toMatchObject([{kind:"sleep",outcome:"query_failed"},{kind:"workout",outcome:"query_completed"}]);
  });

  it("foreground capture remains enabled after background registration fails",async()=>{
    healthkitMocks.configureBackgroundTypes.mockRejectedValueOnce(new Error("registration fixture"));
    healthkitMocks.enableBackgroundDelivery.mockResolvedValue(false);
    await requestHealthKitPermissions();await expect(isHealthKitAutomaticSyncEnabled()).resolves.toBe(true);
    healthkitMocks.queryCategorySamplesWithAnchor.mockResolvedValueOnce({newAnchor:"empty",samples:[],deletedSamples:[]});
    await importHealthKitSleep();expect(healthkitMocks.queryCategorySamplesWithAnchor).toHaveBeenCalledOnce();
    expect(apiMocks.enqueueEvent).not.toHaveBeenCalled();
  });

  it("exports a bounded Health debug snapshot without advancing anchors or leaking routes", async () => {
    asyncStore.set("dayframe.healthkit.sleepAnchor.v1", "sleep-anchor-before");
    asyncStore.set("dayframe.healthkit.workoutAnchor.v1", "workout-anchor-before");
    asyncStore.set("dayframe.healthkit.sleepSeen.v1", JSON.stringify(["old-sleep"]));
    asyncStore.set("dayframe.healthkit.workoutSeen.v1", JSON.stringify(["old-workout"]));
    healthkitMocks.queryCategorySamplesWithAnchor.mockResolvedValueOnce({
      newAnchor: "sleep-anchor-after",
      deletedSamples: [],
      samples: [
        {
          uuid: "debug-core",
          value: 3,
          startDate: "2026-07-06T23:55:00.000Z",
          endDate: "2026-07-07T02:15:00.000Z",
          metadata: { latitude: 51.5, source: "debug" }
        },
        {
          uuid: "debug-rem",
          value: 5,
          startDate: "2026-07-07T02:15:00.000Z",
          endDate: "2026-07-07T06:27:00.000Z"
        }
      ]
    });
    healthkitMocks.queryWorkoutSamplesWithAnchor.mockResolvedValueOnce({
      newAnchor: "workout-anchor-after",
      deletedSamples: [{ uuid: "deleted-workout" }],
      workouts: [
        {
          uuid: "debug-walk",
          workoutActivityType: 52,
          startDate: "2026-07-07T07:00:00.000Z",
          endDate: "2026-07-07T07:16:00.000Z",
          duration: 960,
          metadata: { route: [{ latitude: 51.5, longitude: -0.1 }], HKIndoorWorkout: false }
        }
      ]
    });

    const snapshot = await exportHealthDebugSnapshot({ lookbackDays: 7, limit: 50 });

    expect(healthkitMocks.queryCategorySamplesWithAnchor).toHaveBeenCalledWith(
      "HKCategoryTypeIdentifierSleepAnalysis",
      expect.objectContaining({
        filter: { date: expect.objectContaining({ startDate: expect.any(Date), endDate: expect.any(Date) }) },
        limit: 50
      })
    );
    expect(healthkitMocks.queryWorkoutSamplesWithAnchor).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: { date: expect.objectContaining({ startDate: expect.any(Date), endDate: expect.any(Date) }) },
        limit: 50
      })
    );
    expect(snapshot.storedState).toMatchObject({
      sleepAnchorPresent: true,
      workoutAnchorPresent: true,
      sleepSeenCount: 1,
      workoutSeenCount: 1
    });
    expect(snapshot.healthKit.sleep).toMatchObject({
      sampleCount: 2,
      stageCounts: { asleep_core: 1, asleep_rem: 1 },
      sessions: [
        expect.objectContaining({
          sampleCount: 2,
          autoConfirm: true
        })
      ]
    });
    expect(snapshot.healthKit.workouts).toMatchObject({
      sampleCount: 1,
      deletedSampleCount: 1,
      typeCounts: { walking: 1 }
    });
    expect(snapshot.generatedEvents.workouts[0].rawPayload).toMatchObject({
      workoutType: "walking",
      autoConfirm: true
    });
    expect(JSON.stringify(snapshot)).not.toContain("latitude");
    expect(JSON.stringify(snapshot)).not.toContain("longitude");
    expect(asyncStore.get("dayframe.healthkit.sleepAnchor.v1")).toBe("sleep-anchor-before");
    expect(asyncStore.get("dayframe.healthkit.workoutAnchor.v1")).toBe("workout-anchor-before");
  });

  it("excludes disabled workout types from generated debug events", async () => {
    healthkitMocks.queryCategorySamplesWithAnchor.mockResolvedValueOnce({
      newAnchor: "sleep-anchor-debug",
      deletedSamples: [],
      samples: []
    });
    healthkitMocks.queryWorkoutSamplesWithAnchor.mockResolvedValueOnce({
      newAnchor: "workout-anchor-debug",
      deletedSamples: [],
      workouts: [
        {
          uuid: "debug-strength",
          workoutActivityType: 50,
          startDate: "2026-07-07T11:00:00.000Z",
          endDate: "2026-07-07T12:00:00.000Z",
          duration: 3600
        },
        {
          uuid: "debug-walk",
          workoutActivityType: 52,
          startDate: "2026-07-07T07:00:00.000Z",
          endDate: "2026-07-07T07:16:00.000Z",
          duration: 960
        }
      ]
    });

    const snapshot = await exportHealthDebugSnapshot();

    expect(snapshot.healthKit.workouts).toMatchObject({
      sampleCount: 2,
      typeCounts: { strength_training: 1, walking: 1 }
    });
    expect(snapshot.generatedEvents.workouts.map((event) => event.rawPayload.workoutType)).toEqual([
      "walking"
    ]);
  });

  it("filters disabled sleep sessions before queueing Health events", async () => {
    await setHealthImportPreference("sleep", false);
    healthkitMocks.queryCategorySamplesWithAnchor.mockResolvedValueOnce({
      newAnchor: "sleep-anchor-disabled",
      samples: [
        { uuid: "core", value: 3, startDate: "2026-07-06T23:55:00.000Z", endDate: "2026-07-07T06:27:00.000Z" }
      ]
    });

    const result = await importHealthKitSleep();

    expect(result.importedCount).toBe(0);
    expect(result.status).toBe("disabled");
    expect(healthkitMocks.queryCategorySamplesWithAnchor).not.toHaveBeenCalled();
    expect(apiMocks.enqueueEvent).not.toHaveBeenCalled();
  });

  it("marks short sleep sessions for review instead of auto-confirm", () => {
    const event = healthKitSleepSessionEvent({
      externalSessionId: "short-sleep",
      startedAt: "2026-07-07T04:00:00.000Z",
      stoppedAt: "2026-07-07T04:30:00.000Z",
      samples: [
        sleepSample("short-core", "asleep_core", "2026-07-07T04:00:00.000Z", "2026-07-07T04:30:00.000Z")
      ]
    });

    expect(event.rawPayload.durationSeconds).toBe(1800);
    expect(event.rawPayload.autoConfirm).toBe(false);
  });

  it("maps workout samples into summarized Dayframe workouts", () => {
    const mapped = mapHealthKitWorkoutSample({
      uuid: "workout-1",
      workoutActivityType: 52,
      startDate: "2026-07-03T08:30:00.000Z",
      endDate: "2026-07-03T09:10:00.000Z",
      duration: { quantity: 2400, unit: "s" },
      totalDistance: { quantity: 3200, unit: "m" },
      totalEnergyBurned: { quantity: 180, unit: "kcal" },
      sourceRevision: { source: { name: "Apple Watch" } },
      metadata: { HKIndoorWorkout: false }
    });

    expect(mapped).toMatchObject({
      externalSampleId: "workout-1",
      workoutType: "walking",
      workoutLabel: "Walk",
      startedAt: "2026-07-03T08:30:00.000Z",
      stoppedAt: "2026-07-03T09:10:00.000Z",
      durationSeconds: 2400,
      distanceMeters: 3200,
      energyKcal: 180,
      sourceName: "Apple Watch"
    });
  });

  it("maps strength workouts to friendly labels", () => {
    const mapped = mapHealthKitWorkoutSample({
      uuid: "strength-1",
      workoutActivityType: 50,
      startDate: "2026-07-03T08:30:00.000Z",
      endDate: "2026-07-03T09:10:00.000Z"
    });

    expect(mapped.workoutType).toBe("strength_training");
    expect(mapped.workoutLabel).toBe("Strength training");
    expect(healthKitWorkoutEvent(mapped).description).toBe("Strength training");
  });

  it("normalizes fractional workout durations to whole seconds", () => {
    const mapped = mapHealthKitWorkoutSample({
      uuid: "workout-decimal-duration",
      workoutActivityType: 52,
      startDate: "2026-07-03T08:30:00.000Z",
      endDate: "2026-07-03T09:34:18.123Z",
      duration: { quantity: 3858.122684240341, unit: "s" }
    });

    expect(mapped.durationSeconds).toBe(3858);
    expect(healthKitWorkoutEvent(mapped).rawPayload.durationSeconds).toBe(3858);
  });

  it("builds event-first workout payloads without route locations", () => {
    const event = healthKitWorkoutEvent(
      mapHealthKitWorkoutSample({
        uuid: "workout-2",
        workoutActivityType: "highIntensityIntervalTraining",
        startDate: "2026-07-03T10:00:00.000Z",
        endDate: "2026-07-03T10:30:00.000Z",
        duration: 1800,
        metadata: { route: [{ latitude: 51.5, longitude: -0.1 }] }
      })
    );

    expect(event.source).toBe("health_workout");
    expect(event.type).toBe("health_workout_import");
    expect(event.description).toBe("Workout");
    expect(event.rawPayload).toMatchObject({
      provider: "healthkit",
      externalSampleId: "workout-2",
      workoutType: "other",
      durationSeconds: 1800,
      autoConfirm: false
    });
    expect(JSON.stringify(event.rawPayload)).not.toContain("latitude");
    expect(JSON.stringify(event.rawPayload)).not.toContain("longitude");
  });

  it("stores Health import preferences with sleep enabled and strength disabled by default", async () => {
    await expect(getHealthImportPreferences()).resolves.toMatchObject({
      cycling: true,
      running: true,
      sleep: true,
      strength_training: false,
      swimming: false,
      walking: true,
      other: false
    });

    const saved = await setHealthImportPreference("strength_training", true);

    expect(saved.strength_training).toBe(true);
    await expect(getHealthWorkoutImportPreferences()).resolves.toMatchObject({
      strength_training: true,
      swimming: false
    });
  });

  it("stores Health auto-log mappings for category and description defaults", async () => {
    await expect(getHealthAutoLogMappings()).resolves.toEqual({});

    const saved = await setHealthAutoLogMapping("walking", {
      categoryId: "category-fitness",
      description: "Morning walk"
    });

    expect(saved.walking).toEqual({
      categoryId: "category-fitness",
      description: "Morning walk"
    });
    await expect(getHealthAutoLogMappings()).resolves.toEqual(saved);
  });

  it("applies custom Health mappings to generated sleep and workout events", () => {
    const sleepEvent = healthKitSleepSessionEvent(
      {
        externalSessionId: "mapped-sleep",
        startedAt: "2026-07-07T00:00:00.000Z",
        stoppedAt: "2026-07-07T07:00:00.000Z",
        samples: [
          sleepSample("mapped-core", "asleep_core", "2026-07-07T00:00:00.000Z", "2026-07-07T07:00:00.000Z")
        ]
      },
      {
        categoryId: "category-rest",
        description: "Overnight sleep"
      }
    );
    const workoutEvent = healthKitWorkoutEvent(
      mapHealthKitWorkoutSample({
        uuid: "mapped-walk",
        workoutActivityType: 52,
        startDate: "2026-07-07T08:00:00.000Z",
        endDate: "2026-07-07T08:30:00.000Z"
      }),
      {
        categoryId: "category-fitness",
        description: "Morning walk"
      }
    );

    expect(sleepEvent).toMatchObject({
      categoryId: "category-rest",
      description: "Overnight sleep"
    });
    expect(workoutEvent).toMatchObject({
      categoryId: "category-fitness",
      description: "Morning walk"
    });
  });

  it("enables automatic sleep and workout sync after Health permission is granted", async () => {
    const permission = await requestHealthKitPermissions();

    expect(permission.status).toBe("available");
    expect(healthkitMocks.configureBackgroundTypes).toHaveBeenCalledWith(
      ["HKCategoryTypeIdentifierSleepAnalysis", "HKWorkoutTypeIdentifier"],
      1
    );
    expect(healthkitMocks.enableBackgroundDelivery).toHaveBeenCalledWith("HKCategoryTypeIdentifierSleepAnalysis", 1);
    expect(healthkitMocks.enableBackgroundDelivery).toHaveBeenCalledWith("HKWorkoutTypeIdentifier", 1);
    await expect(isHealthKitAutomaticSyncEnabled()).resolves.toBe(true);
  });

  it("does not mark automatic sync enabled when HealthKit background delivery is unavailable", async () => {
    healthkitMocks.enableBackgroundDelivery.mockResolvedValue(false);

    await expect(configureHealthKitAutomaticSync()).resolves.toBe(false);
    await expect(isHealthKitAutomaticSyncEnabled()).resolves.toBe(false);
  });

  it("subscribes to HealthKit sleep and workout changes only after automatic sync is enabled", async () => {
    await expect(startHealthKitChangeObservers(vi.fn())).resolves.toBeNull();

    await requestHealthKitPermissions();
    const onChange = vi.fn();
    const subscription = await startHealthKitChangeObservers(onChange);
    const sleepCallback = healthkitMocks.subscribeToChanges.mock.calls[0][1];

    expect(healthkitMocks.subscribeToChanges).toHaveBeenCalledWith("HKCategoryTypeIdentifierSleepAnalysis", expect.any(Function));
    expect(healthkitMocks.subscribeToChanges).toHaveBeenCalledWith("HKWorkoutTypeIdentifier", expect.any(Function));

    sleepCallback({ errorMessage: undefined });
    expect(onChange).toHaveBeenCalledWith("HKCategoryTypeIdentifierSleepAnalysis", undefined);
    subscription?.remove();
  });

  it("reprocesses existing Health review items with saved preferences", async () => {
    apiMocks.reprocessHealthReviewItems.mockResolvedValueOnce({
      ok: true,
      checkedCount: 1,
      confirmedCount: 1,
      ignoredCount: 0,
      leftInReviewCount: 0,
      skippedCount: 0,
      failedCount: 0,
      updatedCategoryCount: 1,
      remainingReviewCount: 0,
      errorSummary: []
    });

    await setHealthImportPreference("walking", true);
    await reprocessExistingHealthReviewItems(undefined, { force: true });

    expect(apiMocks.reprocessHealthReviewItems).toHaveBeenCalledWith(
      expect.objectContaining({
        sleep: true,
        walking: true,
        strength_training: false,
        swimming: false
      }),
      { limit: 25, force: true, mappings: {}, cursor: null, deadlineAt: expect.any(Number), signal: undefined }
    );
  });

  it("reprocesses existing Health review items with saved mappings", async () => {
    apiMocks.reprocessHealthReviewItems.mockResolvedValueOnce({
      ok: true,
      checkedCount: 1,
      confirmedCount: 1,
      ignoredCount: 0,
      leftInReviewCount: 0,
      skippedCount: 0,
      failedCount: 0,
      updatedCategoryCount: 1,
      remainingReviewCount: 0,
      errorSummary: []
    });

    await setHealthAutoLogMapping("walking", {
      categoryId: "category-fitness",
      description: "Morning walk"
    });
    await reprocessExistingHealthReviewItems(undefined, { force: true });

    expect(apiMocks.reprocessHealthReviewItems).toHaveBeenCalledWith(
      expect.objectContaining({ walking: true }),
      {
        cursor: null, deadlineAt: expect.any(Number), signal: undefined,
        limit: 25,
        force: true,
        mappings: {
          walking: {
            categoryId: "category-fitness",
            description: "Morning walk"
          }
        }
      }
    );
  });

  it("drains partial Health review reprocess batches during one refresh", async () => {
    apiMocks.reprocessHealthReviewItems
      .mockResolvedValueOnce({
        ok: true,
        checkedCount: 25,
        confirmedCount: 25,
        ignoredCount: 0,
        leftInReviewCount: 0,
        skippedCount: 0,
        failedCount: 0,
        updatedCategoryCount: 25,
        remainingReviewCount: 88,
        batchSize: 25,
        partial: true,
        hasMore: true,
        errorSummary: []
      })
      .mockResolvedValueOnce({
        ok: true,
        checkedCount: 8,
        confirmedCount: 8,
        ignoredCount: 0,
        leftInReviewCount: 0,
        skippedCount: 0,
        failedCount: 0,
        updatedCategoryCount: 8,
        remainingReviewCount: 0,
        batchSize: 25,
        partial: false,
        hasMore: false,
        errorSummary: []
      });

    const result = await reprocessExistingHealthReviewItems(undefined, { force: true });

    expect(apiMocks.reprocessHealthReviewItems).toHaveBeenCalledTimes(2);
    expect(apiMocks.reprocessHealthReviewItems).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ walking: true }),
      { limit: 25, force: true, mappings: {}, cursor: null, deadlineAt: expect.any(Number), signal: undefined }
    );
    expect(apiMocks.reprocessHealthReviewItems).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ walking: true }),
      { limit: 25, force: true, mappings: {}, cursor: null, deadlineAt: expect.any(Number), signal: undefined }
    );
    expect(result).toMatchObject({
      checkedCount: 33,
      confirmedCount: 33,
      updatedCategoryCount: 33,
      remainingReviewCount: 0,
      partial: false,
      hasMore: false
    });
  });

  it("keeps background Health review reprocess failures non-fatal", async () => {
    apiMocks.reprocessHealthReviewItems.mockRejectedValueOnce(new Error("Unable to reprocess Health review items: 500"));

    const result = await reprocessExistingHealthReviewItems(undefined, { force: true });

    expect(result).toMatchObject({
      ok: false,
      failedCount: 1,
      errorSummary: ["Unable to reprocess Health review items: 500"]
    });
    await expect(reprocessExistingHealthReviewItems()).resolves.toMatchObject({
      ok: true,
      checkedCount: 0,
      errorSummary: ["Backoff active."]
    });
    expect(apiMocks.reprocessHealthReviewItems).toHaveBeenCalledTimes(1);
  });

  it("filters disabled workout types before queueing Health events", async () => {
    healthkitMocks.queryWorkoutSamplesWithAnchor.mockResolvedValueOnce({
      newAnchor: "workout-anchor-1", deletedSamples: [],
      workouts: [
        {
          uuid: "walk-1",
          workoutActivityType: 52,
          startDate: "2026-07-03T08:30:00.000Z",
          endDate: "2026-07-03T09:00:00.000Z",
          duration: 1800
        },
        {
          uuid: "strength-1",
          workoutActivityType: 50,
          startDate: "2026-07-03T10:00:00.000Z",
          endDate: "2026-07-03T10:45:00.000Z",
          duration: 2700
        }
      ]
    });

    const result = await importHealthKitWorkouts();

    expect(result.importedCount).toBe(1);
    expect(result.status).toBe("queued");
    expect(apiMocks.enqueueEvent).toHaveBeenCalledTimes(1);
    expect(apiMocks.enqueueEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        localId: expect.stringMatching(/^healthkit:workout:/),
        description: "Walk",
        rawPayload: expect.objectContaining({
          autoConfirm: true,
          workoutType: "walking"
        })
      })
    );
  });

  it("marks short workouts for review instead of auto-confirm", () => {
    const event = healthKitWorkoutEvent(
      mapHealthKitWorkoutSample({
        uuid: "short-walk",
        workoutActivityType: 52,
        startDate: "2026-07-03T08:30:00.000Z",
        endDate: "2026-07-03T08:32:00.000Z",
        duration: 120
      })
    );

    expect(event.rawPayload.autoConfirm).toBe(false);
  });

  it("auto-confirms five-minute walks", () => {
    const event = healthKitWorkoutEvent(
      mapHealthKitWorkoutSample({
        uuid: "five-minute-walk",
        workoutActivityType: 52,
        startDate: "2026-07-03T08:30:00.000Z",
        endDate: "2026-07-03T08:35:00.000Z",
        duration: 300
      })
    );

    expect(event.rawPayload).toMatchObject({
      autoConfirm: true,
      workoutType: "walking"
    });
  });
});

function sleepSample(
  externalSampleId: string,
  stage: "in_bed" | "asleep_core" | "asleep_deep" | "asleep_rem" | "awake",
  startedAt: string,
  stoppedAt: string
) {
  return {
    externalSampleId,
    stage,
    startedAt,
    stoppedAt,
    sourceName: "Apple Watch",
    rawPayload: { uuid: externalSampleId }
  };
}
