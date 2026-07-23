import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WebPlaceSearchController,
  type WebPlaceSearchState
} from "./web-place-search-controller";

const result = {
  id: "synthetic",
  title: "Synthetic Church",
  subtitle: "Example Road",
  formattedAddress: "Synthetic Church, Example Road",
  latitude: 51.7,
  longitude: 0.4,
  resultType: "amenity"
};

describe("WebPlaceSearchController", () => {
  afterEach(() => vi.useRealTimers());

  it("waits for two characters and debounces provider calls", async () => {
    vi.useFakeTimers();
    const search = vi.fn(async () => [result]);
    const states: WebPlaceSearchState[] = [];
    const controller = new WebPlaceSearchController(search, (state) => states.push(state));

    controller.updateQuery("S");
    await vi.advanceTimersByTimeAsync(500);
    expect(search).not.toHaveBeenCalled();

    controller.updateQuery("Sc");
    await vi.advanceTimersByTimeAsync(249);
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(controller.getState().status).toBe("results"));
    expect(search).toHaveBeenCalledTimes(1);
    expect(states.at(-1)?.suggestions).toEqual([result]);
  });

  it("aborts older requests and ignores stale completions", async () => {
    vi.useFakeTimers();
    const resolvers: Array<(value: typeof result[]) => void> = [];
    const signals: AbortSignal[] = [];
    const search = vi.fn((_query: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<typeof result[]>((resolve) => resolvers.push(resolve));
    });
    const controller = new WebPlaceSearchController(search, () => undefined);

    controller.updateQuery("School");
    await vi.advanceTimersByTimeAsync(250);
    controller.updateQuery("Church");
    expect(signals[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    resolvers[0]?.([{ ...result, title: "Stale School" }]);
    resolvers[1]?.([result]);
    await vi.waitFor(() => expect(controller.getState().status).toBe("results"));
    expect(controller.getState().suggestions[0]?.title).toBe("Synthetic Church");
  });

  it("supports keyboard movement, boundaries, selection, Escape and clear", async () => {
    vi.useFakeTimers();
    const second = { ...result, id: "second", title: "Synthetic Sports Centre" };
    const controller = new WebPlaceSearchController(async () => [result, second], () => undefined);
    controller.updateQuery("Synthetic");
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(controller.getState().status).toBe("results"));

    expect(controller.activeSuggestion()?.id).toBe("synthetic");
    controller.moveActive(1);
    expect(controller.activeSuggestion()?.id).toBe("second");
    controller.moveToBoundary("start");
    expect(controller.activeSuggestion()?.id).toBe("synthetic");
    controller.moveToBoundary("end");
    expect(controller.activeSuggestion()?.id).toBe("second");
    controller.dismiss();
    expect(controller.getState().suggestions).toEqual([]);
    controller.commitSelection("Synthetic Sports Centre");
    expect(controller.getState()).toMatchObject({ query: "Synthetic Sports Centre", status: "selected" });
    controller.clear();
    expect(controller.getState()).toMatchObject({ query: "", status: "idle" });
  });

  it("retains calm no-results and provider-unavailable states", async () => {
    vi.useFakeTimers();
    const noResults = new WebPlaceSearchController(async () => [], () => undefined);
    noResults.updateQuery("Nowhere");
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(noResults.getState().status).toBe("no-results"));
    expect(noResults.getState().message).toContain("No matches");

    const unavailable = new WebPlaceSearchController(
      async () => {
        throw new Error("Place search is unavailable. Use Current location or Advanced coordinates.");
      },
      () => undefined
    );
    unavailable.updateQuery("School");
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(unavailable.getState().status).toBe("error"));
    expect(unavailable.getState().message).toContain("Current location");

    const offline = new WebPlaceSearchController(
      async () => {
        throw new TypeError("Failed to fetch");
      },
      () => undefined
    );
    offline.updateQuery("Church");
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(offline.getState().status).toBe("error"));
    expect(offline.getState().message).toBe(
      "Place search is unavailable. Use Current location or Advanced coordinates."
    );
  });

  it("retains a committed selection when an older request later fails", async () => {
    vi.useFakeTimers();
    const deferred: { reject?: (error: Error) => void } = {};
    const controller = new WebPlaceSearchController(
      () => new Promise((_resolve, reject) => {
        deferred.reject = reject;
      }),
      () => undefined
    );
    controller.updateQuery("School");
    await vi.advanceTimersByTimeAsync(250);
    controller.commitSelection("Synthetic School");
    deferred.reject?.(new Error("late provider failure"));
    await Promise.resolve();

    expect(controller.getState()).toMatchObject({
      query: "Synthetic School",
      status: "selected",
      suggestions: []
    });
  });

  it("does not reopen results after blur or Escape dismisses a pending request", async () => {
    vi.useFakeTimers();
    const deferred: { resolve?: (results: typeof result[]) => void } = {};
    const controller = new WebPlaceSearchController(
      () => new Promise((resolve) => {
        deferred.resolve = resolve;
      }),
      () => undefined
    );
    controller.updateQuery("School");
    await vi.advanceTimersByTimeAsync(250);
    controller.dismiss();
    deferred.resolve?.([result]);
    await Promise.resolve();

    expect(controller.getState()).toMatchObject({
      status: "typing",
      suggestions: []
    });
  });
});
