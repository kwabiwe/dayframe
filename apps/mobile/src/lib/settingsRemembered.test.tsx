import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});

type Owner = { userId: string; workspaceId: string } | null;
const account = vi.hoisted(() => ({
  owner: { userId: "u1", workspaceId: "w1" } as Owner,
  // An owner the next readActiveMobileAccount loads silently (no notification), as on startup.
  lazy: null as Owner,
  listeners: new Set<() => void>()
}));
vi.mock("./mobileAccount", () => ({
  getActiveMobileAccountSnapshot: () => account.owner,
  readActiveMobileAccount: async () => {
    if (account.lazy) {
      account.owner = account.lazy;
      account.lazy = null;
    }
    return account.owner;
  },
  subscribeActiveMobileAccount: (listener: () => void) => {
    account.listeners.add(listener);
    return () => account.listeners.delete(listener);
  }
}));
// secure-session bumps its generation on every sign-in, sign-out and invalidation.
const session = vi.hoisted(() => ({ generation: 0, listeners: new Set<() => void>() }));
vi.mock("./secure-session", () => ({
  currentSessionGeneration: () => session.generation,
  subscribeAuthenticatedSession: (listener: () => void) => {
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }
}));

import { publishMobileSignedOut } from "./mobileSessionTransition";
import {
  beginRememberedSettingsRead,
  captureRememberedSettingsBinding,
  readRememberedSetting,
  useRememberedSettingsState,
  writeRememberedSetting,
  type RememberedSettingsSetter
} from "./settingsRemembered";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = { userId: "u1", workspaceId: "w1" };
const B = { userId: "u2", workspaceId: "w1" };

/** An account change as the app makes it: a new sign-in (new generation), then the new owner. */
function signIn(owner: Owner) {
  session.generation += 1;
  account.owner = owner;
  act(() => {
    for (const listener of [...session.listeners]) listener();
    for (const listener of [...account.listeners]) listener();
  });
}

function signOut() {
  session.generation += 1;
  account.owner = null;
  act(() => {
    publishMobileSignedOut();
    for (const listener of [...session.listeners]) listener();
    for (const listener of [...account.listeners]) listener();
  });
}

function mountHook(key = "healthAccessGranted") {
  const seen: { value: boolean | null; set: RememberedSettingsSetter<boolean | null> } = {} as never;
  function Probe() {
    const [value, set] = useRememberedSettingsState<boolean | null>(key, null);
    seen.value = value;
    seen.set = set;
    return null;
  }
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<Probe />); });
  return { rerender: () => act(() => tree.update(<Probe />)), seen, tree };
}

describe("Settings' remembered states (owner, 12 Oct: nothing flips on open)", () => {
  it("hands a page the value an earlier page of the same account read", () => {
    signIn(A);
    writeRememberedSetting("healthAccessGranted", true, captureRememberedSettingsBinding());
    expect(readRememberedSetting("healthAccessGranted")).toBe(true);
    const { seen, tree } = mountHook();
    expect(seen.value).toBe(true);
    act(() => seen.set(false, captureRememberedSettingsBinding()));
    expect(seen.value).toBe(false);
    expect(readRememberedSetting("healthAccessGranted")).toBe(false);
    tree.unmount();
  });

  it("never hands one account's value to another account or workspace", () => {
    signIn(A);
    writeRememberedSetting("healthAccessGranted", true, captureRememberedSettingsBinding());
    account.owner = { userId: "u1", workspaceId: "w2" };
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    account.owner = B;
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    account.owner = null;
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    expect(writeRememberedSetting("healthAccessGranted", false, captureRememberedSettingsBinding())).toBe(false);
    account.owner = A;
    expect(readRememberedSetting("healthAccessGranted")).toBe(true);
  });

  it("forgets everything on sign-out", () => {
    signIn(A);
    writeRememberedSetting("motionFitnessStatus", "authorized", captureRememberedSettingsBinding());
    signOut();
    expect(readRememberedSetting("motionFitnessStatus")).toBeUndefined();
  });
});

describe("remembered states belong to the account and session their read started for (Codex r1–r3 on #355)", () => {
  it("drops a late result from account A that lands after switching to B", () => {
    signIn(A);
    const { seen, tree } = mountHook();
    const readForA = captureRememberedSettingsBinding();
    signIn(B);
    act(() => seen.set(true, readForA));
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    expect(seen.value).toBeNull();
    expect(writeRememberedSetting("healthAccessGranted", true, readForA)).toBe(false);
    // B's own read lands.
    act(() => seen.set(false, captureRememberedSettingsBinding()));
    expect(seen.value).toBe(false);
    expect(readRememberedSetting("healthAccessGranted")).toBe(false);
    tree.unmount();
  });

  it("drops a late result from A's first session after A → B → A", () => {
    signIn(A);
    const { seen, tree } = mountHook();
    const readForFirstA = captureRememberedSettingsBinding();
    signIn(B);
    signIn(A);
    act(() => seen.set(true, readForFirstA));
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    expect(seen.value).toBeNull();
    tree.unmount();
  });

  it("never refills the cache after sign-out (even when the same account signs back in)", () => {
    signIn(A);
    const { seen, tree } = mountHook();
    const readBeforeSignOut = captureRememberedSettingsBinding();
    signOut();
    act(() => seen.set(true, readBeforeSignOut));
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    expect(seen.value).toBeNull();
    signIn(A);
    act(() => seen.set(true, readBeforeSignOut));
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    expect(seen.value).toBeNull();
    tree.unmount();
  });

  it("resets a mounted page's state when the account changes, to initial or the new account's value", () => {
    signIn(B);
    writeRememberedSetting("healthAccessGranted", false, captureRememberedSettingsBinding());
    signIn(A);
    const { seen, tree } = mountHook();
    act(() => seen.set(true, captureRememberedSettingsBinding()));
    expect(seen.value).toBe(true);
    signIn(B);
    // B remembered nothing in this session (its earlier value was from an earlier sign-in).
    expect(seen.value).toBeNull();
    act(() => seen.set(false, captureRememberedSettingsBinding()));
    expect(seen.value).toBe(false);
    signOut();
    expect(seen.value).toBeNull();
    tree.unmount();
  });

  it("shows nothing from the earlier account between a change and its notification", () => {
    signIn(A);
    const { rerender, seen, tree } = mountHook();
    act(() => seen.set(true, captureRememberedSettingsBinding()));
    expect(seen.value).toBe(true);
    // The generation moves before the session notifies its listeners.
    session.generation += 1;
    account.owner = B;
    rerender();
    expect(seen.value).toBeNull();
    tree.unmount();
  });

  it("binds a read to the owner it resolved for: null → silently loaded A → B drops A's late result (Codex r3)", async () => {
    signIn(null);
    const { rerender, seen, tree } = mountHook();
    // The read starts before the active account is known; it loads A without any notification.
    account.lazy = A;
    const readForA = await beginRememberedSettingsRead();
    expect(readForA.ownerKey).toBe("u1:w1");
    // Startup reconciliation then activates B within the same session.
    account.owner = B;
    act(() => {
      for (const listener of [...account.listeners]) listener();
    });
    act(() => seen.set(true, readForA));
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    rerender();
    expect(seen.value).toBeNull();
    // A read started for B lands.
    const readForB = await beginRememberedSettingsRead();
    act(() => seen.set(false, readForB));
    expect(seen.value).toBe(false);
    expect(readRememberedSetting("healthAccessGranted")).toBe(false);
    tree.unmount();
  });

  it("drops A's late result after a silent A → B replacement with no notification at all", async () => {
    signIn(null);
    const { rerender, seen, tree } = mountHook();
    account.lazy = A;
    const readForA = await beginRememberedSettingsRead();
    account.owner = B;
    act(() => seen.set(true, readForA));
    rerender();
    expect(seen.value).toBeNull();
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    tree.unmount();
  });

  it("never lands a read started before any account was known", () => {
    signIn(null);
    const { rerender, seen, tree } = mountHook();
    const readForNobody = captureRememberedSettingsBinding();
    act(() => seen.set(true, readForNobody));
    account.owner = A;
    act(() => seen.set(true, readForNobody));
    rerender();
    expect(seen.value).toBeNull();
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    tree.unmount();
  });
});
