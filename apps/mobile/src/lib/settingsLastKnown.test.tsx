import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The device: AsyncStorage and the Keychain survive a "launch" (vi.resetModules); module state doesn't.
const disk = vi.hoisted(() => ({
  values: new Map<string, string>(),
  // Lets a test hold one key's read open, as a slow launch read would be.
  heldReads: new Map<string, Promise<void>>()
}));
const keychain = vi.hoisted(() => new Map<string, string>());
// A locked iPhone: Keychain reads fail as iOS reports it.
const keychainState = vi.hoisted(() => ({ locked: false }));

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
  getItemAsync: async (key: string) => {
    if (keychainState.locked) throw new Error("User interaction is not allowed.");
    return keychain.get(key) ?? null;
  },
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
  keychainState.locked = false;
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
    // A live read lands while the stored payload is still being read (the session is loaded by then).
    await app.session.readAuthenticatedSessionSnapshot();
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

describe("Codex r1 on #365: ownership, account lifetimes, renewal and first-frame hydration", () => {
  it("never shows A's stored values to a restored session of B (interrupted replacement)", async () => {
    await persistFor(A, { healthAccessGranted: true, activities: { count: 7, pinned: 3 } });
    // B's sign-in wrote its session, then the app ended before anything else ran (A's account and
    // stored values are still on the device).
    const storedA = new Map(disk.values);
    const interrupted = await launch();
    await interrupted.session.setSessionToken("token-b", B);
    for (const [key, value] of storedA) disk.values.set(key, value);
    expect(storedPayload(A)?.values).toEqual({ healthAccessGranted: true, activities: { count: 7, pinned: 3 } });
    const app = await launch();
    expect(await app.account.readActiveMobileAccount()).toEqual(A);
    const session = await app.session.readAuthenticatedSessionSnapshot();
    expect(session).toMatchObject({ status: "authenticated", snapshot: { owner: B } });
    await app.lastKnown.primeSettingsLastKnown();
    await app.settle();
    const page = app.mount();
    expect(app.lastKnown.readSettingsLastKnown()).toBeNull();
    expect(page.renders.every((value) => value === null)).toBe(true);
    // A write bound to A while B's session is loaded records nothing either.
    expect(app.lastKnown.recordSettingsLastKnown({ placesCount: 1 }, app.remembered.captureRememberedSettingsBinding())).toBe(false);
    // B's bootstrap then activates B: A's values are cleared, never shown.
    await app.account.activateMobileAccount(B);
    await app.settle();
    expect(app.lastKnown.readSettingsLastKnown()).toBeNull();
    expect(storedPayload(A)).toBeNull();
    page.unmount();
  });

  it("keeps the stored values but shows nothing while the Keychain can't be read", async () => {
    await persistFor(A, { healthAccessGranted: true });
    const app = await launch();
    keychainState.locked = true;
    await app.lastKnown.primeSettingsLastKnown();
    await app.settle();
    expect(app.lastKnown.readSettingsLastKnown()).toBeNull();
    expect(storedPayload(A)?.values).toEqual({ healthAccessGranted: true });
    // Once the session is read and proves to be A's, they show.
    keychainState.locked = false;
    await app.session.readAuthenticatedSessionSnapshot();
    expect(app.lastKnown.readSettingsLastKnown()).toEqual({ healthAccessGranted: true });
  });

  it("rejects a read captured before an A→B→A replacement", async () => {
    const app = await launch();
    await app.signIn(A);
    const oldRead = await app.remembered.beginRememberedSettingsRead();
    await app.account.activateMobileAccount(B);
    await app.account.activateMobileAccount(A);
    await app.settle();
    expect(app.lastKnown.recordSettingsLastKnown({ healthAccessGranted: true }, oldRead)).toBe(false);
    expect(storedKeys()).toEqual([]);
  });

  it("keeps the values through a same-account session renewal and fences the old session's work", async () => {
    const app = await persistFor(A, { healthAccessGranted: true });
    const readBeforeRenewal = await app.remembered.beginRememberedSettingsRead();
    await app.session.setSessionToken("refreshed-token-a", A);
    await app.settle();
    expect(app.lastKnown.readSettingsLastKnown()).toEqual({ healthAccessGranted: true });
    expect(storedPayload(A)?.values).toEqual({ healthAccessGranted: true });
    // Work started in the previous session never lands.
    expect(app.lastKnown.recordSettingsLastKnown({ placesCount: 5 }, readBeforeRenewal)).toBe(false);
    // Work in the renewed session does.
    await app.remember("motionFitnessStatus", "authorized");
    expect(storedPayload(A)?.values).toEqual({ healthAccessGranted: true, motionFitnessStatus: "authorized" });
  });

  it("still clears when a different account's session replaces the active one", async () => {
    const app = await persistFor(A, { healthAccessGranted: true });
    await app.session.setSessionToken("token-b", B);
    await app.settle();
    expect(app.lastKnown.readSettingsLastKnown()).toBeNull();
    expect(storedKeys()).toEqual([]);
  });

  it("keeps the values through a restored same-account launch, owner binding and bootstrap activation", async () => {
    await persistFor(A, { healthAccessGranted: true });
    const app = await launch();
    const session = await app.session.readAuthenticatedSessionSnapshot();
    expect(session).toMatchObject({ status: "authenticated", snapshot: { owner: A } });
    await app.lastKnown.primeSettingsLastKnown();
    if (session.status === "authenticated") await app.session.bindAuthenticatedSessionOwner(session.snapshot, A);
    await app.account.activateMobileAccount(A);
    await app.settle();
    expect(app.lastKnown.readSettingsLastKnown()).toEqual({ healthAccessGranted: true });
    expect(storedPayload(A)?.values).toEqual({ healthAccessGranted: true });
  });

  /** A Settings page: what it would show on each render (nothing while it holds its rows). */
  function mountSettingsPage(app: Awaited<ReturnType<typeof launch>>, waitMs?: number) {
    const shown: Array<{ ready: boolean; values: ReturnType<typeof app.lastKnown.readSettingsLastKnown> }> = [];
    function Page() {
      const values = app.lastKnown.useSettingsLastKnown();
      const ready = app.lastKnown.useSettingsLastKnownReady(waitMs);
      shown.push({ ready, values });
      return null;
    }
    let tree!: import("react-test-renderer").ReactTestRenderer;
    app.renderer.act(() => {
      tree = app.renderer.create(app.react.createElement(Page));
    });
    return { shown, visible: () => shown.filter((render) => render.ready).map((render) => render.values), unmount: () => app.renderer.act(() => tree.unmount()) };
  }

  it("mounted during launch hydration, Settings holds its rows and then shows the stored values once (no flip)", async () => {
    await persistFor(A, { healthAccessGranted: true, motionFitnessStatus: "authorized" });
    let release!: () => void;
    disk.heldReads.set(storedKeys()[0], new Promise<void>((resolve) => { release = resolve; }));
    const app = await launch();
    // The root layout starts hydration when its module is evaluated...
    const priming = app.lastKnown.primeSettingsLastKnown();
    expect(app.lastKnown.isSettingsLastKnownSettled()).toBe(false);
    // ...and a deep link opens Settings before the stored read returns.
    const page = mountSettingsPage(app);
    expect(page.shown[0]).toEqual({ ready: false, values: null });
    await app.renderer.act(async () => {
      release();
      await priming;
      await app.settle();
    });
    const visible = page.visible();
    expect(visible.length).toBeGreaterThan(0);
    // Every render the user could see shows the stored values: never empty first.
    expect(visible.every((values) => JSON.stringify(values) === JSON.stringify({ healthAccessGranted: true, motionFitnessStatus: "authorized" }))).toBe(true);
    page.unmount();
  });

  it("opened after hydration, Settings is ready with the stored values on its first render", async () => {
    await persistFor(A, { healthAccessGranted: true });
    const app = await launch();
    await app.lastKnown.primeSettingsLastKnown();
    await app.settle();
    const page = mountSettingsPage(app);
    expect(page.shown[0]).toEqual({ ready: true, values: { healthAccessGranted: true } });
    page.unmount();
  });

  it("does not hold Settings for longer than the bound when hydration stalls", async () => {
    await persistFor(A, { healthAccessGranted: true });
    disk.heldReads.set(storedKeys()[0], new Promise<void>(() => undefined));
    const app = await launch();
    void app.lastKnown.primeSettingsLastKnown();
    const page = mountSettingsPage(app, 20);
    expect(page.shown[0].ready).toBe(false);
    await app.renderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(page.shown.at(-1)?.ready).toBe(true);
    page.unmount();
  });

  it("Settings' queue read never stores another account's counts after an A→B→A race", async () => {
    const app = await launch();
    await app.signIn(A);
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(__dirname, "../../app/settings.tsx"), "utf8");
    const start = source.indexOf("  async function refreshQueueLatest() {");
    const body = source.slice(start, source.indexOf("\n  const load =", start));
    const create = new Function(
      "beginRememberedSettingsRead", "readQueue", "readActiveMobileAccount", "mobileAccountOwnersEqual",
      "isRememberedSettingsBindingCurrent", "setQueueAndCache", "setQueueKnown", "getQueueDiagnostics",
      "recordSettingsLastKnown", "queueMounted", "queueReadSequence",
      `${body}; return refreshQueueLatest;`
    );
    const readOwners: unknown[] = [];
    const published: unknown[] = [];
    const refresh = create(
      async () => {
        const startedFor = await app.remembered.beginRememberedSettingsRead();
        // A replacement commits right after the read was bound to A.
        await app.account.activateMobileAccount(B);
        return startedFor;
      },
      async (owner: unknown) => {
        readOwners.push(owner);
        // A second replacement brings A back while the read is in flight.
        await app.account.activateMobileAccount(A);
        return [{ id: "q1" }, { id: "q2" }];
      },
      app.account.readActiveMobileAccount,
      app.account.mobileAccountOwnersEqual,
      app.remembered.isRememberedSettingsBindingCurrent,
      (queue: unknown) => published.push(queue),
      () => undefined,
      (items: unknown[]) => ({ queuedCount: items.length, permanentFailedCount: 0 }),
      app.lastKnown.recordSettingsLastKnown,
      { current: true },
      { current: 0 }
    );
    await refresh();
    await app.settle();
    // The queue was read for A (the account the read started for), not the active B...
    expect(readOwners).toEqual([A]);
    // ...and nothing from that earlier A lifetime reached the screen or the device.
    expect(published).toEqual([]);
    expect(storedPayload(A)).toBeNull();
  });
});
