import { beforeEach, describe, expect, it, vi } from "vitest";

const asyncStore = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncStore.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { asyncStore.set(key, value); })
  }
}));

import type { TrackingNoticeDependencies } from "./trackingNotice";
import type { ReviewNudgePermission } from "./reviewNudgeNative";

const {
  __resetTrackingNoticeForTests,
  installTrackingNotice,
  readTrackingNoticeEnabled,
  setTrackingNoticeEnabled,
  syncTrackingNoticeArming,
  trackingNoticeArmed
} = await import("./trackingNotice");

function harness(overrides: Partial<TrackingNoticeDependencies> = {}) {
  const lifecycle = { appState: [] as Array<() => void>, signedOut: [] as Array<() => void> };
  const base = {
    readEnabled: vi.fn(readTrackingNoticeEnabled),
    readNotificationPermission: vi.fn(async (): Promise<ReviewNudgePermission | null> => "granted"),
    readLocationConsent: vi.fn(async () => true),
    readAlwaysLocation: vi.fn(async () => true),
    setArmed: vi.fn(async (_armed: boolean) => undefined)
  };
  // Overrides are mocks too; the cast keeps their mock helpers visible to the tests.
  const deps = Object.assign(base, overrides) as typeof base;
  installTrackingNotice(deps, {
    subscribeAppState: (listener) => lifecycle.appState.push(listener),
    subscribeSignedOut: (listener) => lifecycle.signedOut.push(listener)
  });
  return { deps, lifecycle };
}

const lastArmed = (setArmed: { mock: { calls: unknown[][] } }) => setArmed.mock.calls.at(-1)?.[0];

describe("tracking-stopped notice arming", () => {
  beforeEach(() => {
    asyncStore.clear();
    __resetTrackingNoticeForTests();
  });

  it("arms only with the switch on, notifications allowed, location consent and Always access", () => {
    const all = { enabled: true, notificationPermission: "granted" as const, locationConsent: true, alwaysLocation: true };
    expect(trackingNoticeArmed(all)).toBe(true);
    expect(trackingNoticeArmed({ ...all, enabled: false })).toBe(false);
    expect(trackingNoticeArmed({ ...all, notificationPermission: "undetermined" })).toBe(false);
    expect(trackingNoticeArmed({ ...all, notificationPermission: "denied" })).toBe(false);
    expect(trackingNoticeArmed({ ...all, notificationPermission: null })).toBe(false);
    expect(trackingNoticeArmed({ ...all, locationConsent: false })).toBe(false);
    expect(trackingNoticeArmed({ ...all, alwaysLocation: false })).toBe(false);
  });

  it("defaults the switch on and remembers turning it off", async () => {
    await expect(readTrackingNoticeEnabled()).resolves.toBe(true);
    const { deps } = harness();
    await syncTrackingNoticeArming();
    expect(lastArmed(deps.setArmed)).toBe(true);
    await setTrackingNoticeEnabled(false);
    await expect(readTrackingNoticeEnabled()).resolves.toBe(false);
    expect(lastArmed(deps.setArmed)).toBe(false);
  });

  it("recomputes on every app-state change, so turning location off disarms before the app switcher", async () => {
    let consent = true;
    const { deps, lifecycle } = harness({ readLocationConsent: vi.fn(async () => consent) });
    await syncTrackingNoticeArming();
    expect(lastArmed(deps.setArmed)).toBe(true);
    consent = false;
    for (const listener of lifecycle.appState) listener();
    await syncTrackingNoticeArming();
    expect(lastArmed(deps.setArmed)).toBe(false);
  });

  it("disarms on sign-out even while an older recompute is still reading", async () => {
    let release!: () => void;
    const { deps, lifecycle } = harness({
      readLocationConsent: vi.fn(() => new Promise<boolean>((resolve) => { release = () => resolve(true); }))
    });
    await vi.waitFor(() => expect(deps.readLocationConsent).toHaveBeenCalled());
    for (const listener of lifecycle.signedOut) listener();
    release();
    await vi.waitFor(() => expect(deps.setArmed).toHaveBeenCalledWith(false));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deps.setArmed.mock.calls.map(([armed]) => armed)).toEqual([false]);
  });

  it("disarms when a read fails", async () => {
    const { deps } = harness({ readAlwaysLocation: vi.fn(async () => { throw new Error("permission read failed"); }) });
    await syncTrackingNoticeArming();
    expect(lastArmed(deps.setArmed)).toBe(false);
  });

  it("installs once", async () => {
    const first = harness();
    const second = harness();
    await syncTrackingNoticeArming();
    expect(second.deps.setArmed).not.toHaveBeenCalled();
    expect(first.deps.setArmed).toHaveBeenCalled();
  });
});
