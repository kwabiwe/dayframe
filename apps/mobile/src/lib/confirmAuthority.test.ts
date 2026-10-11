import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  owner: { userId: "user-a", workspaceId: "ws-a" } as { userId: string; workspaceId: string } | null,
  session: { generation: 1, owner: { userId: "user-a", workspaceId: "ws-a" }, token: "token-a" } as
    | { generation: number; owner: { userId: string; workspaceId: string } | null; token: string }
    | null
}));

vi.mock("./mobileAccount", () => ({
  mobileAccountOwnersEqual: (
    left: { userId: string; workspaceId: string } | null | undefined,
    right: { userId: string; workspaceId: string } | null | undefined
  ) => left?.userId === right?.userId && left?.workspaceId === right?.workspaceId,
  readActiveMobileAccount: async () => state.owner
}));
vi.mock("./secure-session", () => ({
  isAuthenticatedSessionSnapshotCurrent: (snapshot: { generation: number; token: string }) =>
    state.session !== null && snapshot.generation === state.session.generation && snapshot.token === state.session.token,
  readAuthenticatedSessionSnapshot: async () => state.session
    ? { status: "authenticated", snapshot: { ...state.session } }
    : { status: "signed_out" }
}));

const { bindConfirmToSession, captureConfirmAuthority, confirmAuthorityStillCurrent } = await import("./confirmAuthority");

function signInAs(user: string, generation: number) {
  state.owner = { userId: user, workspaceId: `ws-${user}` };
  state.session = { generation, owner: { ...state.owner }, token: `token-${user}-${generation}` };
}

beforeEach(() => signInAs("a", 1));

describe("confirmation authority (consent is bound to its session)", () => {
  it("pins the signed-in account and session, and nothing when signed out", async () => {
    const authority = await captureConfirmAuthority();
    expect(authority?.owner).toEqual({ userId: "a", workspaceId: "ws-a" });
    expect(await confirmAuthorityStillCurrent(authority)).toBe(true);
    state.session = null;
    expect(await captureConfirmAuthority()).toBeNull();
    expect(await confirmAuthorityStillCurrent(null)).toBe(false);
  });

  it("refuses a session whose owner is not the active account", async () => {
    state.session = { generation: 2, owner: { userId: "b", workspaceId: "ws-b" }, token: "token-b" };
    expect(await captureConfirmAuthority()).toBeNull();
  });

  it("voids consent given for account A once account B (or a new session for A) is current", async () => {
    const authority = await captureConfirmAuthority();
    signInAs("b", 2);
    expect(await confirmAuthorityStillCurrent(authority)).toBe(false);
    signInAs("a", 3);
    // Same account, a new session: still not the session that was asked.
    expect(await confirmAuthorityStillCurrent(authority)).toBe(false);
  });

  it("runs the confirmed action only while its session is still current", async () => {
    const authority = (await captureConfirmAuthority())!;
    const logOut = vi.fn();
    const onStale = vi.fn();
    const bound = bindConfirmToSession({ title: "Log out?", onConfirm: logOut }, authority, { onStale });
    expect(bound.title).toBe("Log out?");

    // The account changes while the sheet is open or leaving.
    signInAs("b", 2);
    bound.onConfirm();
    await vi.waitFor(() => expect(onStale).toHaveBeenCalledTimes(1));
    expect(logOut).not.toHaveBeenCalled();

    signInAs("a", 1);
    state.session = { ...state.session!, token: authority.snapshot.token };
    bound.onConfirm();
    await vi.waitFor(() => expect(logOut).toHaveBeenCalledTimes(1));
  });

  it("treats a failed check as stale", async () => {
    const authority = (await captureConfirmAuthority())!;
    const action = vi.fn();
    const onStale = vi.fn();
    bindConfirmToSession({ onConfirm: action }, authority, { onStale, stillCurrent: () => Promise.reject(new Error("read failed")) }).onConfirm();
    await vi.waitFor(() => expect(onStale).toHaveBeenCalledTimes(1));
    expect(action).not.toHaveBeenCalled();
  });
});
