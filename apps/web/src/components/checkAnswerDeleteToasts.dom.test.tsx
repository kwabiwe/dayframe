// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, ReviewItemRow, TimeEntryRow } from "@/lib/queries";

// Codex r2 on #618: a "?" answer's Undo and a delete's Undo pending together both stay reachable (stacked toasts).
// Synthetic ids and names only.
const navigation = vi.hoisted(() => ({ search: "date=2026-10-06&scope=day&view=list" }));
const runtime = vi.hoisted(() => {
  const values: Record<string, unknown> = { dateLoadError: null, isDateLoading: false, isTimerBusy: false, shellData: null };
  return new Proxy(values, {
    get(target, key: string) {
      if (key in target) return target[key];
      target[key] = vi.fn(async () => ({ ok: true }));
      return target[key];
    }
  });
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/timeline",
  useSearchParams: () => new URLSearchParams(navigation.search)
}));
vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => runtime,
  useRuntimePageData: (value: unknown) => value
}));
const clientFetch = vi.hoisted(() => vi.fn(async () => new Response("{}", { status: 404 })));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch }));
const clock = vi.hoisted(() => ({ todayStartMs: 0 }));
vi.mock("@/components/useCalendarClock", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/useCalendarClock")>(),
  useLocalDayStartMs: () => clock.todayStartMs
}));

const { TimeReviewViews } = await import("./TimeReviewViews");
const { CheckDecisionsProvider } = await import("./location/ListChecks");

const local = (hour: number, minute = 0) => new Date(2026, 9, 6, hour, minute).toISOString();
const BLOCK = "00000000-0000-4000-8000-0000000000e1";
const LUNCH = "00000000-0000-4000-8000-0000000000e2";
const block = (id: string, description: string, start: string, stop: string): TimeEntryRow => ({
  id, categoryId: null, categoryName: null, categoryColor: null, projectId: null, projectName: null, projectColor: null, clientName: null,
  placeId: null, placeName: null, source: "manual_app", confidence: "high", reviewStatus: "confirmed", description, startedAt: start,
  stoppedAt: stop, updatedAt: stop, durationSeconds: 0, tagNames: [], tags: []
});
const clash: ReviewItemRow = {
  id: "00000000-0000-4000-8000-0000000000c1", type: "location_timer_trip_clash", title: "Team sync ran 30m into your trip",
  eventSource: "location_learning", eventType: "timer_trip_clash", projectName: null, categoryName: null, categoryColor: null, placeName: null,
  suggestedProjectId: null, suggestedCategoryId: null, suggestedPlaceId: null, suggestedStartedAt: local(8), suggestedStoppedAt: local(10),
  confidence: "high", status: "open", notes: null, createdAt: local(11), proposalHash: "c".repeat(64),
  rawPayload: { timeEntryId: BLOCK, tripId: "trip", tripStartedAt: local(10), tripStoppedAt: local(10, 45), overlapSeconds: 1_800 }
};

function bootstrap(): BootstrapData {
  const entries = [block(LUNCH, "Lunch", local(12), local(12, 30)), block(BLOCK, "Team sync", local(8), local(10, 30))];
  return {
    activeEntry: null, user: { id: "user", email: "user@example.test", name: "Test User", dailyGoalMinutes: 480, weeklyGoalMinutes: 2400 },
    workspace: { id: "workspace", name: "Dayframe" }, workspaces: [{ id: "workspace", name: "Dayframe" }], categories: [], categoryUsage: [],
    clients: [], projects: [], tags: [], places: [], learnedPlaces: [], automationRules: [], taskSuggestions: [], reviewItems: [clash],
    activityEvents: [], entries, historyEntries: entries, dayEntries: entries, weekEntries: entries,
    stats: { todaySeconds: 0, weekSeconds: 0, todayCoveredSeconds: 0, weekCoveredSeconds: 0, todayAdditionalOverlapSeconds: 0,
      weekAdditionalOverlapSeconds: 0, reviewCount: 1, reviewCardCount: 1 },
    todaySeries: [], weekSeries: [],
    dateRange: { selectedDate: "2026-10-06", previousDate: "2026-10-05", nextDate: "2026-10-07", dayStart: local(0),
      dayEnd: new Date(2026, 9, 7).toISOString(), weekStart: new Date(2026, 9, 5).toISOString(), weekEnd: new Date(2026, 9, 12).toISOString() }
  } as unknown as BootstrapData;
}

describe("a \"?\" answer's Undo and a delete's Undo together (Codex r2 on #618)", () => {
  beforeEach(() => {
    clock.todayStartMs = new Date(2026, 9, 6).getTime();
    runtime.shellData = bootstrap();
    Element.prototype.scrollIntoView ??= () => undefined;
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
    Object.defineProperty(window, "matchMedia", { configurable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }) });
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { disconnect() {} observe() {} unobserve() {} } });
    Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: class { disconnect() {} observe() {} unobserve() {} } });
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("stacks the answer's Undo above the delete's, and both Undos work", async () => {
    const data = bootstrap();
    await act(async () => {
      const views = createElement(TimeReviewViews, { initialData: data, initialPreference: null, renderedAt: local(13) });
      render(<CheckDecisionsProvider categories={[]} owner="workspace:user" refresh={async () => undefined} reviewItems={data.reviewItems}>{views}</CheckDecisionsProvider>);
    });
    const mark = () => screen.queryByRole("button", { name: "Team sync: Team sync ran 30m into your trip, Needs a look" });
    fireEvent.click(await vi.waitFor(() => mark()!));
    const asked = screen.getByRole("group", { name: "Team sync ran 30m into your trip, Needs a look" });
    fireEvent.click(within(asked).getAllByRole("button")[0]);
    expect(mark()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete Lunch" }));
    await vi.waitFor(() => expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(2));
    const answerToast = screen.getByText(/^Ended Team sync at /).closest(".df-toast-host")!;
    const deleteToast = screen.getAllByRole("button", { name: "Undo" }).map((button) => button.closest(".df-toast-host")!)
      .find((host) => host !== answerToast)!;
    expect(answerToast.classList.contains("is-stacked")).toBe(true);
    expect(deleteToast.classList.contains("is-stacked")).toBe(false);
    // The delete's Undo brings Lunch back; the answer's Undo is still there and brings the "?" back.
    fireEvent.click(within(deleteToast as HTMLElement).getByRole("button", { name: "Undo" }));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Delete Lunch" })).toBeTruthy());
    fireEvent.click(within(answerToast as HTMLElement).getByRole("button", { name: "Undo" }));
    await vi.waitFor(() => expect(mark()).toBeTruthy());
    expect((clientFetch.mock.calls as unknown as Array<[string]>).some(([url]) => url.startsWith("/api/review/"))).toBe(false);
  });
});
