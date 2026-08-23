import { describe, expect, it, vi } from "vitest";
import type { MobileBootstrap } from "./api";
import {
  beginRecoveredDashboardBootstrapPublication,
  subscribeRecoveredDashboardBootstrap
} from "./dashboardBootstrapChannel";

describe("recovered dashboard bootstrap publication", () => {
  it("publishes one terminal abandonment when recovery fails", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecoveredDashboardBootstrap(listener);
    const publication = beginRecoveredDashboardBootstrapPublication();

    publication.abandon();
    publication.abandon();
    publication.publish({} as MobileBootstrap);
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
    const publication = beginRecoveredDashboardBootstrapPublication();
    const bootstrap = {} as MobileBootstrap;

    publication.publish(bootstrap);
    publication.abandon();
    publication.publish(bootstrap);
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.map(([event]) => event.type)).toEqual([
      "started",
      "completed"
    ]);
    expect(listener.mock.calls[1]?.[0].bootstrap).toBe(bootstrap);
  });
});
