import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ epoch: 0 }));
vi.mock("./mobileAccount", () => ({ currentMobileAccountEpoch: () => account.epoch }));
import {
  requestShortcutStop,
  resetShortcutStopRequestsForTests,
  SHORTCUT_STOP_COALESCE_MS,
  SHORTCUT_STOP_REQUEST_TTL_MS,
  subscribeShortcutStopRequests,
  takeShortcutStopRequest
} from "./shortcutStopRequests";

describe("shortcut Stop requests", () => {
  beforeEach(() => {
    resetShortcutStopRequestsForTests();
    account.epoch = 0;
  });

  it("is taken once, and tells subscribers when it arrives", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeShortcutStopRequests(listener);
    expect(requestShortcutStop(1_000)).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(takeShortcutStopRequest(1_500)).toBe(true);
    expect(takeShortcutStopRequest(1_600)).toBe(false);
    unsubscribe();
    requestShortcutStop(10_000);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("coalesces the same link reported by both URL handlers", () => {
    expect(requestShortcutStop(1_000)).toBe(true);
    expect(requestShortcutStop(1_000 + SHORTCUT_STOP_COALESCE_MS - 1)).toBe(false);
    expect(takeShortcutStopRequest(1_100)).toBe(true);
    expect(takeShortcutStopRequest(1_200)).toBe(false);
    expect(requestShortcutStop(1_000 + SHORTCUT_STOP_COALESCE_MS)).toBe(true);
  });

  it("expires unused, so a late hand-off cannot stop a block started afterwards", () => {
    requestShortcutStop(1_000);
    expect(takeShortcutStopRequest(1_000 + SHORTCUT_STOP_REQUEST_TTL_MS + 1)).toBe(false);
    expect(takeShortcutStopRequest(1_000 + SHORTCUT_STOP_REQUEST_TTL_MS + 2)).toBe(false);
  });

  it("has nothing to take before any link", () => {
    expect(takeShortcutStopRequest(1_000)).toBe(false);
  });

  it("is void after a sign-out, sign-in or account switch, so it never stops another account's block", () => {
    requestShortcutStop(1_000);
    account.epoch += 1;
    expect(takeShortcutStopRequest(1_500)).toBe(false);
    requestShortcutStop(5_000);
    expect(takeShortcutStopRequest(5_500)).toBe(true);
  });
});
