import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocationRefreshGate, LOCATION_REFRESH_COALESCE_MS } from "./durableLocationRefreshGate";

describe("location refresh gate for the durable-work snapshot", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does no work in the background and refreshes once when the app becomes active", () => {
    let active = false;
    const refresh = vi.fn();
    const gate = createLocationRefreshGate({ isActive: () => active, refresh });
    for (let sample = 0; sample < 50; sample += 1) gate.locationChanged();
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
    active = true;
    gate.appBecameActive();
    gate.appBecameActive();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does nothing on becoming active when no location changed meanwhile", () => {
    const refresh = vi.fn();
    const gate = createLocationRefreshGate({ isActive: () => true, refresh });
    gate.appBecameActive();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("coalesces a foreground burst into one refresh after the window", () => {
    const refresh = vi.fn();
    const gate = createLocationRefreshGate({ isActive: () => true, refresh });
    for (let mutation = 0; mutation < 20; mutation += 1) gate.locationChanged();
    vi.advanceTimersByTime(LOCATION_REFRESH_COALESCE_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledOnce();
    gate.locationChanged();
    vi.advanceTimersByTime(LOCATION_REFRESH_COALESCE_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("defers a foreground timer that fires after the app left, and never refreshes twice on return", () => {
    let active = true;
    const refresh = vi.fn();
    const gate = createLocationRefreshGate({ isActive: () => active, refresh });
    gate.locationChanged();
    active = false;
    vi.advanceTimersByTime(LOCATION_REFRESH_COALESCE_MS);
    expect(refresh).not.toHaveBeenCalled();
    active = true;
    gate.locationChanged();
    gate.appBecameActive();
    expect(refresh).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(LOCATION_REFRESH_COALESCE_MS);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("drops a pending refresh when disposed", () => {
    const refresh = vi.fn();
    const gate = createLocationRefreshGate({ isActive: () => true, refresh });
    gate.locationChanged();
    gate.dispose();
    vi.advanceTimersByTime(LOCATION_REFRESH_COALESCE_MS);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("durable-work monitor wiring", () => {
  it("routes location-store changes through the gate, never straight to a refresh", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./durableWorkMonitor.ts", import.meta.url), "utf8");
    expect(source).toContain("subscribeLocationStore(locationGate.locationChanged)");
    expect(source).not.toContain("subscribeLocationStore(request)");
    expect(source).toContain('if (state === "active") locationGate.appBecameActive();');
  });
});
