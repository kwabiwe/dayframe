import { describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ owner: { userId: "u1", workspaceId: "w1" } as { userId: string; workspaceId: string } | null }));
vi.mock("./mobileAccount", () => ({ getActiveMobileAccountSnapshot: () => account.owner }));

import { publishMobileSignedOut } from "./mobileSessionTransition";
import { readRememberedSetting, writeRememberedSetting } from "./settingsRemembered";

describe("Settings' remembered states (owner, 12 Oct: nothing flips on open)", () => {
  it("hands a page the value an earlier page of the same account read", () => {
    account.owner = { userId: "u1", workspaceId: "w1" };
    writeRememberedSetting("healthAccessGranted", true);
    expect(readRememberedSetting("healthAccessGranted")).toBe(true);
  });

  it("never hands one account's value to another account or workspace", () => {
    account.owner = { userId: "u1", workspaceId: "w1" };
    writeRememberedSetting("healthAccessGranted", true);
    account.owner = { userId: "u1", workspaceId: "w2" };
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    account.owner = { userId: "u2", workspaceId: "w1" };
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    account.owner = null;
    expect(readRememberedSetting("healthAccessGranted")).toBeUndefined();
    writeRememberedSetting("healthAccessGranted", false);
    account.owner = { userId: "u1", workspaceId: "w1" };
    expect(readRememberedSetting("healthAccessGranted")).toBe(true);
  });

  it("forgets everything on sign-out", () => {
    account.owner = { userId: "u1", workspaceId: "w1" };
    writeRememberedSetting("motionFitnessStatus", "authorized");
    publishMobileSignedOut();
    expect(readRememberedSetting("motionFitnessStatus")).toBeUndefined();
  });
});
