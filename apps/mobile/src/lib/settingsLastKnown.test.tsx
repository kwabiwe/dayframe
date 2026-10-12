import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The device: AsyncStorage and the Keychain survive a "launch" (vi.resetModules); module state doesn't.
const disk = vi.hoisted(() => ({
  values: new Map<string, string>(),
  // Lets a test hold one key's read open, as a slow launch read would be.
  heldReads: new Map<string, Promise<void>>()
}));
const keychain = vi.hoisted(() => new Map<string, string>());

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => {
      await disk.heldReads.get(key);
      return disk.values.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      disk.values.set(key, value);
    },
    removeItem: async (key: string) => {
      disk.values.delete(key);
    },
    getAllKeys: async () => [...disk.values.keys()],
    multiRemove: async (keys: string[]) => {
      for (const key of keys) disk.values.delete(key);
    }
  }
}));

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => keychain.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    keychain.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    keychain.delete(key);
  }
}));

vi.mock("react-native", () => ({
  NativeModules: {},
  Platform: { OS: "ios" }
}));

vi.mock("./config", () => ({
  DAYFRAME_API_BASE: "https://dayframe-staging.vercel.app"
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Owner = { userId: string; workspaceId: string };
const A: Owner = { userId: "user-a", workspaceId: "ws-1" };
const B: Owner = { userId: "user-b", workspaceId: "ws-1" };
const A_OTHER_WORKSPACE: Owner = { userId: "user-a", workspaceId: "ws-2" };
const PREFIX = "dayframe:settings-last-known:";

/** A cold app launch: fresh modules (no memory), the same disk and Keychain. */
async function launch() {
  vi.resetModules();
  const renderer = await import("react-test-renderer");
  const react = await import("react");
  const account = await import("./mobileAccount");
  const session = await import("./secure-session");
  const transition = await import("./mobileSessionTransition");
  const remembered = await import("./settingsRemembered");
  const lastKnown = await import("./settingsLastKnown");
  const app = {
    renderer,
    react,
    account,
    session,
    transition,
    remembered,
    lastKnown,
    /** Lets queued storage steps and their notifications run. */
    async settle() {
      for (let turn = 0; turn < 5; turn += 1) {
        await lastKnown.__settingsLastKnownStorageIdleForTests();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
    /** As `authenticate()` does it: a new session, then the account. */
    async signIn(owner: Owner) {
      await session.setSessionToken(`token-${owner.userId}-${owner.workspaceId}`, owner);
      await account.activateMobileAccount(owner);
      await app.settle();
    },
    /** As `logout()` and Settings do it: the account leaves, the session clears, sign-out is published. */
    async signOut() {
      const owner = await account.readActiveMobileAccount();
      if (owner) await account.deactivateMobileAccount(owner);
      await session.clearSessionToken();
      transition.publishMobileSignedOut();
      await app.settle();
    },
    /** A live Settings read for the current account: what `useRememberedSettingsState` publishes. */
    async remember(key: string, value: unknown) {
      const binding = await remembered.beginRememberedSettingsRead();
      remembered.writeRememberedSetting(key, value, binding);
      await app.settle();
    },
    /** Renders the Settings display layer's hook and keeps every value it rendered with. */
    mount() {
      const renders: Array<ReturnType<typeof lastKnown.useSettingsLastKnown>> = [];
      function Probe() {
        renders.push(lastKnown.useSettingsLastKnown());
        return null;
      }
      let tree!: import("react-test-renderer").ReactTestRenderer;
      renderer.act(() => {
        tree = renderer.create(react.createElement(Probe));
      });
      return { renders, unmount: () => renderer.act(() => tree.unmount()) };
    }
  };
  return app;
}

function storedKeys() {
  return [...disk.values.keys()].filter((key) => key.startsWith(PREFIX));
}

function storedPayload(owner: Owner) {
  const key = storedKeys().find((candidate) => candidate.endsWith(`:${encodeURIComponent(owner.workspaceId)}:${encodeURIComponent(owner.userId)}`));
  return key ? (JSON.parse(disk.values.get(key)!) as Record<string, unknown>) : null;
}

/** A previous run's payload for `owner`, written the way the app writes it. */
async function persistFor(owner: Owner, values: Record<string, unknown>) {
  const app = await launch();
  await app.signIn(owner);
  app.lastKnown.recordSettingsLastKnown(values, app.remembered.captureRememberedSettingsBinding());
  await app.settle();
  return app;
}

beforeEach(() => {
  disk.values.clear();
  disk.heldReads.clear();
  keychain.clear();
});

afterEach(() => {
  vi.resetModules();
});

describe("Settings' last-known values on the device (A4)", () => {
  it("paints the stored values on the first render after a cold launch", async () => {
    await persistFor(A, {
      healthAccessGranted: true,
      motionFitnessStatus: "authorized",
      reviewNudge: { enabled: true, minutes: 21 * 60 },
      nudgePermission: "granted",
      sync: { queuedCount: 2 }
    });
    expect(storedKeys()).toHaveLength(1);

    const app = await launch();
    // App start primes the cache (root layout), long before Settings opens.
    await app.lastKnown.primeSettingsLastKnown();
    await app.settle();
    const page = app.mount();
    expect(page.renders[0]).toEqual({
      healthAccessGranted: true,
      motionFitnessStatus: "authorized",
      reviewNudge: { enabled: true, minutes: 21 * 60 },
      nudgePermission: "granted",
      sync: { queuedCount: 2 }
    });
    // A live read that agrees changes nothing; one that differs changes only that field.
    await app.remember("healthAccessGranted", true);
    await app.remember("motionFitnessStatus", "denied");
    expect(page.renders.at(-1)).toMatchObject({ healthAccessGranted: true, motionFitnessStatus: "denied", nudgePermission: "granted" });
    expect(storedPayload(A)?.values).toMatchObject({ motionFitnessStatus: "denied", healthAccessGranted: true });
    page.unmount();
  });

  it("keeps values that land during the launch read and stores both", async () => {
    await persistFor(A, { healthAccessGranted: true, placesCount: 3 });
    const app = await launch();
    let release!: () => void;
    disk.heldReads.set(storedKeys()[0], new Promise<void>((resolve) => { release = resolve; }));
    const priming = app.lastKnown.primeSettingsLastKnown();
    // A live read lands while the stored payload is still being read.
    const binding = await app.remembered.beginRememberedSettingsRead();
    app.remembered.writeRememberedSetting("motionFitnessStatus", "authorized", binding);
    release();
    await priming;
    await app.settle();
    expect(app.lastKnown.readSettingsLastKnown()).toEqual({ healthAccessGranted: true, placesCount: 3, motionFitnessStatus: "authorized" });
    expect(storedPayload(A)?.values).toEqual({ healthAccessGranted: true, placesCount: 3, motionFitnessStatus: "authorized" });
  });

  it("A→B→A: B never sees A's values, and A's are cleared by the replacement", async () => {
    await persistFor(A, { healthAccessGranted: true, motionFitnessStatus: "authorized" });
    const app = await launch();
    await app.lastKnown.primeSettingsLastKnown();
    await app.settle();
    const page = app.mount();
    expect(page.renders.at(-1)).toMatchObject({ healthAccessGranted: true });

    await app.signOut();
    await app.signIn(B);
    expect(app.lastKnown.readSettingsLastKnown()).toBeNull();
    expect(storedPayload(A)).toBeNull();
    await app.remember("healthAccessGranted", false);
    expect(app.lastKnown.readSettingsLastKnown()).toEqual({ healthAccessGranted: false });
    expect(storedKeys()).toHaveLength(1);
    expect(storedPayload(B)?.values).toEqual({ healthAccessGranted: false });
    // B's page never rendered A's values after the switch.
    const afterSwitch = page.renders.slice(page.renders.findIndex((value) => value === null));
    expect(afterSwitch.every((value) => value === null || value.motionFitnessStatus === undefined)).toBe(true);
    expect(afterSwitch.every((value) => value === null || value.healthAccessGranted !== true)).toBe(true);

    await app.signOut();
    await app.signIn(A);
    expect(app.lastKnown.readSettingsLastKnown()).toBeNull();
    expect(storedKeys()).toEqual([]);
    // And a later launch as A has nothing of B's or the old A's.
    const relaunch = await launch();
    await relaunch.lastKnown.primeSettingsLastKnown();
    expect(relaunch.lastKnown.readSettingsLastKnown()).toBeNull();
    page.unmount();
  });

  it("clears when the account or workspace is replaced without a sign-out", async () => {
    await persistFor(A, { healthAccessGranted: true });
    const app = await launch();
    await app.lastKnown.primeSettingsLastKnown();
    await app.settle();
    expect(app.lastKnown.readSettingsLastKnown()).toEqual({ healthAccessGranted: true });
    await app.account.activateMobileAccount(A_OTHER_WORKSPACE);
    await app.settle();
    expect(app.lastKnown.readSettingsLastKnown()).toBeNull();
    expect(storedKeys()).toEqual([]);
  });

  it("clears on sign-out, in memory and on disk, including a write queued just before it", async () => {
    const app = await persistFor(A, { healthAccessGranted: true });
    const page = app.mount();
    expect(page.renders.at(-1)).toEqual({ healthAccessGranted: true });
    app.lastKnown.recordSettingsLastKnown({ placesCount: 4 }, app.remembered.captureRememberedSettingsBinding());
    const signingOut = app.signOut();
    await signingOut;
    expect(app.lastKnown.readSettingsLastKnown()).toBeNull();
    expect(page.renders.at(-1)).toBeNull();
    expect(storedKeys()).toEqual([]);
    page.unmount();
  });

  it("drops a launch read that finishes after a sign-out or account switch (it never paints)", async () => {
    await persistFor(A, { healthAccessGranted: true });
    const app = await launch();
    let release!: () => void;
    disk.heldReads.set(storedKeys()[0], new Promise<void>((resolve) => { release = resolve; }));
    const page = app.mount();
    const priming = app.lastKnown.primeSettingsLastKnown();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Sign out while the read is still open (storage steps wait behind it).
    await app.account.deactivateMobileAccount(A);
    await app.session.clearSessionToken();
    app.renderer.act(() => app.transition.publishMobileSignedOut());
    release();
    await priming;
    await app.settle();
    expect(app.lastKnown.readSettingsLastKnown()).toBeNull();
    expect(page.renders.every((value) => value === null)).toBe(true);
    // A's stored values went with the sign-out.
    expect(storedPayload(A)).toBeNull();
    await app.signIn(B);
    expect(app.lastKnown.readSettingsLastKnown()).toBeNull();
    expect(page.renders.every((value) => value === null)).toBe(true);
    page.unmount();
  });

  it("drops a launch read that finishes after A signs out and back in (a new session)", async () => {
    await persistFor(A, { healthAccessGranted: true });
    const app = await launch();
    let release!: () => void;
    disk.heldReads.set(storedKeys()[0], new Promise<void>((resolve) => { release = resolve; }));
    const priming = app.lastKnown.primeSettingsLastKnown();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await app.account.deactivateMobileAccount(A);
    await app.session.clearSessionToken();
    app.transition.publishMobileSignedOut();
    await app.session.setSessionToken("token-a-2", A);
    await app.account.activateMobileAccount(A);
    release();
    await priming;
    await app.settle();
    expect(app.lastKnown.readSettingsLastKnown()).toBeNull();
    expect(storedKeys()).toEqual([]);
  });

  it("drops a value whose read started for another account or session", async () => {
    const app = await launch();
    await app.signIn(A);
    const readForA = await app.remembered.beginRememberedSettingsRead();
    await app.signOut();
    await app.signIn(B);
    expect(app.lastKnown.recordSettingsLastKnown({ healthAccessGranted: true }, readForA)).toBe(false);
    // A new session of the same account is not the session the read started in either.
    const readForB = await app.remembered.beginRememberedSettingsRead();
    await app.signOut();
    await app.signIn(B);
    expect(app.lastKnown.recordSettingsLastKnown({ healthAccessGranted: true }, readForB)).toBe(false);
    await app.settle();
    expect(app.lastKnown.readSettingsLastKnown()).toBeNull();
    expect(storedKeys()).toEqual([]);
  });

  it("ignores and removes a corrupt, old-schema or foreign payload", async () => {
    const seedKey = async (raw: string) => {
      const app = await persistFor(A, { healthAccessGranted: true });
      const key = storedKeys()[0];
      disk.values.set(key, raw);
      return { app, key };
    };
    for (const raw of [
      "{not json",
      JSON.stringify({ schema: 0, backend: "https://dayframe-staging.vercel.app", workspaceId: A.workspaceId, userId: A.userId, values: { healthAccessGranted: true } }),
      JSON.stringify({ schema: 1, backend: "https://dayframe-web.vercel.app", workspaceId: A.workspaceId, userId: A.userId, values: { healthAccessGranted: true } }),
      JSON.stringify({ schema: 1, backend: "https://dayframe-staging.vercel.app", workspaceId: B.workspaceId, userId: B.userId, values: { healthAccessGranted: true } }),
      JSON.stringify({ schema: 1, backend: "https://dayframe-staging.vercel.app", workspaceId: A.workspaceId, userId: A.userId, values: "nope" })
    ]) {
      const { key } = await seedKey(raw);
      const app = await launch();
      await app.lastKnown.primeSettingsLastKnown();
      await app.settle();
      expect(app.lastKnown.readSettingsLastKnown()).toBeNull();
      expect(disk.values.has(key)).toBe(false);
      disk.values.clear();
      keychain.clear();
    }
  });

  it("keeps only allow-listed display fields from a stored payload", async () => {
    await persistFor(A, { healthAccessGranted: true });
    const key = storedKeys()[0];
    disk.values.set(key, JSON.stringify({
      schema: 1,
      backend: "https://dayframe-staging.vercel.app",
      workspaceId: A.workspaceId,
      userId: A.userId,
      values: {
        healthAccessGranted: "yes",
        motionFitnessStatus: "authorized",
        token: "secret-token",
        location: { foregroundPermission: "granted", backgroundPermission: "granted", learningEnabled: true, learningActive: true, captureState: "active", lastPlaceName: "Home", latitude: 51.5 },
        reviewNudge: { enabled: true, minutes: 99999 },
        sync: { queuedCount: 2, clientEventId: "evt-1", reviewIssueCount: -1 }
      }
    }));
    const app = await launch();
    await app.lastKnown.primeSettingsLastKnown();
    await app.settle();
    expect(app.lastKnown.readSettingsLastKnown()).toEqual({
      motionFitnessStatus: "authorized",
      location: { foregroundPermission: "granted", backgroundPermission: "granted", learningEnabled: true, learningActive: true, captureState: "active" },
      sync: { queuedCount: 2 }
    });
  });

  it("stores only display-level states: no tokens, coordinates, place names, IDs or free text", async () => {
    const app = await launch();
    await app.signIn(A);
    // Real shapes as Settings reads them, full of things that must never be stored.
    const diagnostics = {
      foregroundPermission: "granted",
      backgroundPermission: "granted",
      activeMonitorCount: 2,
      monitoredPlaceNames: ["Home", "Gym on Baker Street"],
      lastPlaceName: "Home",
      lastGeofenceEvent: { transition: "enter", placeName: "Home", occurredAt: "2026-10-12T08:00:00Z" },
      lastStatus: "Monitoring 2 saved places.",
      locationLearningEnabled: true,
      locationLearningActive: true,
      locationLearningCaptureState: "active"
    } as unknown as import("./geofence").LocationVisitDiagnostics;
    const binding = app.remembered.captureRememberedSettingsBinding();
    app.lastKnown.recordSettingsLastKnown({
      location: app.lastKnown.settingsLocationDisplay(diagnostics),
      activities: { count: 9, pinned: 4 },
      placesCount: 2,
      healthImportPreferences: { sleep: true, walking: false }
    }, binding);
    // Raw objects handed straight in are rebuilt from the allow-list too.
    app.lastKnown.recordSettingsLastKnown({ location: diagnostics } as never, binding);
    await app.remember("reviewNudge", { enabled: true, minutes: 20 * 60, knownCount: 3, knownAt: "2026-10-12T07:00:00Z", lastFireAt: "2026-10-12T19:00:00Z", firedOn: "2026-10-11" });
    await app.remember("nudgePermission", "granted");
    await app.remember("healthAccessGranted", true);
    await app.remember("motionFitnessStatus", "authorized");
    await app.remember("iosSettingsNeeded", false);
    await app.remember("reviewSyncDiagnostics", { waitingCount: 1, authenticationRequiredCount: 0, lastError: "token-xyz rejected" });
    await app.remember("reviewSyncIssues", [{ clientMutationId: "mut-1", resolutionStatus: "rejected", title: "Gym on Baker Street" }]);
    await app.remember("timeEntrySyncDiagnostics", { pendingCount: 2, quarantinedCount: 0, deviceQuarantinedCount: 0 });
    await app.remember("timeEntrySyncIssues", [{ clientCommandId: "cmd-1", description: "Dentist" }]);
    await app.remember("timerStopSyncDiagnostics", { pendingCount: 0 });
    await app.remember("timerStopSyncIssues", []);
    await app.remember("nativeLocationStatus", { authorizationStatus: "authorizedAlways", pendingSignalCount: 4, nativeStoreErrorCode: "E1" });

    expect(storedKeys()).toEqual([
      `${PREFIX}v1:${encodeURIComponent("https://dayframe-staging.vercel.app")}:ws-1:user-a`
    ]);
    const payload = storedPayload(A)!;
    expect(Object.keys(payload).sort()).toEqual(["backend", "schema", "userId", "values", "workspaceId"]);
    expect(payload).toMatchObject({ schema: 1, backend: "https://dayframe-staging.vercel.app", workspaceId: "ws-1", userId: "user-a" });
    expect(payload.values).toEqual({
      location: { foregroundPermission: "granted", backgroundPermission: "granted", learningEnabled: true, learningActive: true, captureState: "active" },
      activities: { count: 9, pinned: 4 },
      placesCount: 2,
      healthImportPreferences: { sleep: true, walking: false },
      reviewNudge: { enabled: true, minutes: 20 * 60 },
      nudgePermission: "granted",
      healthAccessGranted: true,
      motionFitnessStatus: "authorized",
      iosSettingsNeeded: false,
      sync: {
        reviewWaitingCount: 1,
        reviewSignInCount: 0,
        reviewIssueCount: 1,
        timeEntryPendingCount: 2,
        quarantinedCount: 0,
        deviceQuarantinedCount: 0,
        timeEntryIssueCount: 1,
        timerStopPendingCount: 0,
        timerStopIssueCount: 0
      }
    });
    // Every leaf is a boolean, a number or a short enum word.
    const leaves: unknown[] = [];
    const walk = (value: unknown) => {
      if (value && typeof value === "object") Object.values(value).forEach(walk);
      else leaves.push(value);
    };
    walk(payload.values);
    for (const leaf of leaves) {
      expect(typeof leaf === "boolean" || typeof leaf === "number" || (typeof leaf === "string" && /^[a-z_]+$/.test(leaf))).toBe(true);
    }
    const raw = disk.values.get(storedKeys()[0])!;
    for (const secret of ["token", "Home", "Baker", "Dentist", "mut-1", "cmd-1", "2026-10", "knownCount", "E1", "Monitoring"]) {
      expect(raw).not.toContain(secret);
    }
    // Nothing reached the Keychain from here: only the session token lives there.
    expect([...keychain.keys()].every((key) => key.startsWith("dayframe.localSessionToken"))).toBe(true);
  });
});
