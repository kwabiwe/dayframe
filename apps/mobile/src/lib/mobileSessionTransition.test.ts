import { describe, expect, it, vi } from "vitest";
import {
  publishMobileSignedOut,
  subscribeMobileSignedOut
} from "./mobileSessionTransition";

describe("mobile signed-out transition", () => {
  it("publishes synchronously to every mounted session owner", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeMobileSignedOut(first);
    const unsubscribeSecond = subscribeMobileSignedOut(second);

    publishMobileSignedOut();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it("does not notify an owner after it unsubscribes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMobileSignedOut(listener);
    unsubscribe();

    publishMobileSignedOut();

    expect(listener).not.toHaveBeenCalled();
  });
});
