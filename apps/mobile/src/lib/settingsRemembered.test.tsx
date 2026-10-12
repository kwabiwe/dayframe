import type { SetStateAction } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});

type Owner = { userId: string; workspaceId: string } | null;
const account = vi.hoisted(() => ({ owner: { userId: "u1", workspaceId: "w1" } as Owner, listeners: new Set<() => void>() }));
vi.mock("./mobileAccount", () => ({
  getActiveMobileAccountSnapshot: () => account.owner,
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
  captureRememberedSettingsBinding,
  readRememberedSetting,
  useRememberedSettingsState,
  writeRememberedSetting
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
  const seen: { value: boolean | null; set: (action: SetStateAction<boolean | null>) => void } = {} as never;
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
    act(() => seen.set(false));
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

describe("remembered states belong to the account and session they were read in (Codex r1 on #355)", () => {
  it("drops a late result from account A that lands after switching to B", () => {
    signIn(A);
    const { seen, tree } = mountHook();
    const setFromA = seen.set;
    signIn(B);
    act(() => setFromA(true));
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    expect(seen.value).toBeNull();
    // A direct write bound to A is refused too.
    expect(writeRememberedSetting("healthAccessGranted", true, { generation: session.generation - 1, ownerKey: "u1:w1" })).toBe(false);
    // B's own setter still works.
    act(() => seen.set(false));
    expect(seen.value).toBe(false);
    expect(readRememberedSetting("healthAccessGranted")).toBe(false);
    tree.unmount();
  });

  it("drops a late result from A's first session after A → B → A", () => {
    signIn(A);
    const { seen, tree } = mountHook();
    const setFromFirstA = seen.set;
    signIn(B);
    signIn(A);
    act(() => setFromFirstA(true));
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    expect(seen.value).toBeNull();
    tree.unmount();
  });

  it("never refills the cache after sign-out (even when the same account signs back in)", () => {
    signIn(A);
    const { seen, tree } = mountHook();
    const setBeforeSignOut = seen.set;
    signOut();
    act(() => setBeforeSignOut(true));
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    expect(seen.value).toBeNull();
    signIn(A);
    act(() => setBeforeSignOut(true));
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    expect(seen.value).toBeNull();
    tree.unmount();
  });

  it("resets a mounted page's state when the account changes, to initial or the new account's value", () => {
    signIn(B);
    writeRememberedSetting("healthAccessGranted", false, captureRememberedSettingsBinding());
    signIn(A);
    const { seen, tree } = mountHook();
    act(() => seen.set(true));
    expect(seen.value).toBe(true);
    signIn(B);
    // B remembered nothing in this session (its earlier value was from an earlier sign-in).
    expect(seen.value).toBeNull();
    act(() => seen.set(false));
    signOut();
    expect(seen.value).toBeNull();
    tree.unmount();
  });

  it("shows nothing from the earlier account between a change and its notification", () => {
    signIn(A);
    const { rerender, seen, tree } = mountHook();
    act(() => seen.set(true));
    expect(seen.value).toBe(true);
    // The generation moves before the session notifies its listeners.
    session.generation += 1;
    account.owner = B;
    rerender();
    expect(seen.value).toBeNull();
    tree.unmount();
  });

  it("keeps a value read before the active account had loaded, within the same session", () => {
    signIn(null);
    const { seen, tree } = mountHook();
    act(() => seen.set(true));
    expect(seen.value).toBe(true);
    // The account snapshot loads lazily (no new sign-in): the value stays and now publishes.
    account.owner = A;
    act(() => seen.set(true));
    expect(seen.value).toBe(true);
    expect(readRememberedSetting("healthAccessGranted")).toBe(true);
    tree.unmount();
  });

  it("lets a binding made before the account loaded claim only the first owner: null → A → B (Codex r2)", () => {
    signIn(null);
    const { rerender, seen, tree } = mountHook();
    const setBeforeOwner = seen.set;
    // The active account loads (no new sign-in): the setter publishes under A.
    account.owner = A;
    act(() => setBeforeOwner(true));
    expect(seen.value).toBe(true);
    expect(readRememberedSetting("healthAccessGranted")).toBe(true);
    // Startup reconciliation replaces the owner within the same session, before any notification.
    account.owner = B;
    act(() => setBeforeOwner(false));
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    rerender();
    expect(seen.value).toBeNull();
    // And after B's notification: the earlier setter stays spent, B starts from initial.
    act(() => {
      for (const listener of [...account.listeners]) listener();
    });
    act(() => setBeforeOwner(false));
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    expect(seen.value).toBeNull();
    act(() => seen.set(false));
    expect(readRememberedSetting("healthAccessGranted")).toBe(false);
    tree.unmount();
  });

  it("lets an unclaimed binding claim the owner it first resolves to on notification, then holds it", () => {
    signIn(null);
    const { rerender, seen, tree } = mountHook();
    const setBeforeOwner = seen.set;
    account.owner = B;
    act(() => {
      for (const listener of [...account.listeners]) listener();
    });
    act(() => setBeforeOwner(true));
    expect(readRememberedSetting("healthAccessGranted")).toBe(true);
    account.owner = A;
    act(() => setBeforeOwner(false));
    rerender();
    expect(seen.value).toBeNull();
    account.owner = B;
    expect(readRememberedSetting("healthAccessGranted")).toBe(true);
    tree.unmount();
  });
});
