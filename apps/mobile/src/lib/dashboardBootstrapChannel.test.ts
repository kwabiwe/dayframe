import { describe, expect, it, vi } from "vitest";
import type { MobileBootstrap } from "./api";
import { createDashboardReadOrder } from "./dashboardRefresh";
import {
  beginRecoveredDashboardBootstrapPublication,
  subscribeRecoveredDashboardBootstrap
} from "./dashboardBootstrapChannel";

describe("recovered dashboard bootstrap publication", () => {
  it("publishes one terminal abandonment when recovery fails", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecoveredDashboardBootstrap(listener);
    const publication = beginRecoveredDashboardBootstrapPublication(20);

    publication.abandon();
    publication.abandon();
    publication.publish({} as MobileBootstrap, {} as MobileBootstrap);
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.map(([event]) => event.type)).toEqual([
      "started",
      "abandoned"
    ]);
    expect(listener.mock.calls[1]?.[0].publicationId).toBe(
      listener.mock.calls[0]?.[0].publicationId
    );
  });

  it("publishes completion once and makes the finally abandonment a no-op", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecoveredDashboardBootstrap(listener);
    const publication = beginRecoveredDashboardBootstrapPublication(20);
    const bootstrap = {} as MobileBootstrap;
    const serverBootstrap = {} as MobileBootstrap;

    publication.publish(bootstrap, serverBootstrap);
    publication.abandon();
    publication.publish(bootstrap, serverBootstrap);
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.map(([event]) => event.type)).toEqual([
      "started",
      "completed"
    ]);
    expect(listener.mock.calls[1]?.[0].requestedAt).toBe(20);
    expect(listener.mock.calls[1]?.[0].bootstrap).toBe(bootstrap);
    expect(listener.mock.calls[1]?.[0].serverBootstrap).toBe(serverBootstrap);
  });
});

it("keeps a newer live publication when an older read finishes reconciliation late", async () => {
  const order = createDashboardReadOrder();
  const shown = vi.fn();
  let finishOlder!: () => void;
  const olderReconciliation = new Promise<void>((resolve) => { finishOlder = resolve; });
  const older = olderReconciliation.then(() => {
    if (order.accept(10)) shown("stale");
  });
  if (order.accept(20)) shown("canonical trip");
  finishOlder();
  await older;
  expect(shown).toHaveBeenCalledExactlyOnceWith("canonical trip");
  order.reset();
  expect(order.accept(10)).toBe(true);
});
