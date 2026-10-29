// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, ReviewItemRow, TimeEntryRow } from "@/lib/queries";

// Codex r2 on #623 (latent since #609): the decisions owner is keyed on the canonical shell account, so a Calendar date
// load (the selected period's data briefly null, then another date's) never resets what is held, saving or saved.
// Synthetic ids and names only.
vi.mock("next/navigation", () => ({
  usePathname: () => "/timeline",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));
const runtime = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/components/AppShellRuntime", () => ({
  AppShellRuntimeProvider: ({ children }: { children: unknown }) => children,
  useAppShellRuntime: () => runtime.value
}));
const clientFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch }));
const today = vi.hoisted(() => ({ startMs: 0 }));
vi.mock("@/components/useCalendarClock", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/useCalendarClock")>(),
  useLocalDayStartMs: () => today.startMs
}));

const { CheckDecisionsHost } = await import("./AppShell");
const { useProjectedReviewItems, useSharedCheckDecisions } = await import("./location/ListChecks");

const local = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BLOCK = id(9_001);
const CLASH = id(7_001);
const PLACE = id(7_002);
const item = (n: number): ReviewItemRow => ({
  id: id(n), type: "suggestion", title: `Suggestion ${n}`, eventSource: "health_sleep", eventType: "health_sleep_import_suggestion",
  projectName: null, categoryName: null, categoryColor: null, placeName: null, suggestedProjectId: null, suggestedCategoryId: null,
  suggestedPlaceId: null, suggestedStartedAt: local(27, 1), suggestedStoppedAt: local(27, 2), confidence: "medium", status: "open",
  notes: null, rawPayload: null, createdAt: local(27, 3)
});
const place: ReviewItemRow = { ...item(0), id: PLACE, title: "Visited Office", eventSource: "location_learning", eventType: "unknown_stay",
  rawPayload: { clientSegmentId: "seg-office" } };
const block: TimeEntryRow = {
  id: BLOCK, projectId: null, projectName: null, projectColor: null, clientName: null, categoryId: null, categoryName: null, categoryColor: null,
  placeId: null, placeName: null, source: "manual_web", confidence: "high", reviewStatus: "confirmed", description: "Team sync",
  startedAt: local(27, 8), stoppedAt: null, updatedAt: local(27, 8), durationSeconds: 0, tagNames: [], tags: []
};
function bootstrap(selectedDate: string): BootstrapData {
  // A full bootstrap (100 open items: the place "?" and 99 others), so the clash is only past the cap.
  const reviewItems = [place, ...Array.from({ length: 99 }, (_, n) => item(n + 1))];
  return {
    activeEntry: block, user: { id: "user", name: "Test" }, workspace: { id: "workspace", name: "Dayframe" }, categories: [], reviewItems,
    entries: [], historyEntries: [], dayEntries: [], weekEntries: [], dateRange: { selectedDate }
  } as unknown as BootstrapData;
}
const clashRecord = {
  kind: "review", reviewItemId: CLASH, eventId: null, locationSegmentId: null, sourceKind: "generic", eventSource: "location_learning",
  eventType: "timer_trip_clash", title: "Team sync ran 30m into your trip", category: { id: null, name: null, color: null },
  place: { id: null, label: null }, interval: { start: local(27, 8), end: local(27, 10) }, confidence: "high", status: "open",
  createdAt: local(27, 11), updatedAt: local(27, 11), proposalHash: "f".repeat(64), canonicalEntryIds: [], semanticRevision: null,
  timerTripClash: { timeEntryId: BLOCK, tripId: "trip", tripStartedAt: local(27, 10), tripStoppedAt: local(27, 11),
    overlapSeconds: 1_800 }
};
const presentation = () => new Response(JSON.stringify({
  version: 1, scope: { mode: "window", timeZone: "UTC" }, snapshotToken: "s", capturedAt: local(28, 9), nextCursor: null,
  completeness: { records: true, outstandingCounts: true, completedToday: false, partialReason: null },
  outstanding: { globalCount: 0, todayCount: 0, openReviewItemIds: [] }, records: [clashRecord], links: [], lookup: { reviewItems: [], entries: [] }
}));

function Probe() {
  const items = useProjectedReviewItems([]);
  const decisions = useSharedCheckDecisions();
  return (
    <>
      <output data-testid="items">{items.map((one) => one.id).filter((one) => one === CLASH || one === PLACE).join(",")}</output>
      <output data-testid="held">{decisions?.state.decided.map((decision) => decision.itemId).join(",")}</output>
      <button onClick={() => decisions?.answer(CLASH, "skip", "Kept Team sync")} type="button">Keep it</button>
      <button onClick={() => decisions?.answer(PLACE, "skip")} type="button">Not now</button>
    </>
  );
}
const shown = () => screen.getByTestId("items").textContent;
const held = () => screen.getByTestId("held").textContent;

describe("the decisions owner across a Calendar date load (Codex r2 on #623)", () => {
  beforeEach(() => {
    today.startMs = new Date(2026, 9, 28).getTime();
    clientFetch.mockReset().mockImplementation(async (url: string) => url === "/api/review/presentation" ? presentation() : new Response("{}"));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each([["a recovered clash", "Keep it", CLASH], ["an ordinary place \"?\"", "Not now", PLACE]])(
    "%s answered, then an uncached date loads for the same account: it stays hidden with its save pending", async (_name, answerLabel, answered) => {
      const shell = bootstrap("2026-10-28");
      runtime.value = { canonicalShellData: shell, data: shell, shellData: shell, refresh: vi.fn(async () => shell), setProjectedEnds: vi.fn() };
      const view = render(<CheckDecisionsHost><Probe /></CheckDecisionsHost>);
      // The clash is recovered past the cap (its block is the running one).
      await vi.waitFor(() => expect(shown()).toBe(`${PLACE},${CLASH}`));
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      act(() => screen.getByRole("button", { name: answerLabel }).click());
      expect(shown()).not.toContain(answered);
      expect(held()).toBe(answered);
      // Navigate to an uncached date: the selected period's data is null meanwhile; then that date loads, same account.
      runtime.value = { ...runtime.value, data: null };
      view.rerender(<CheckDecisionsHost><Probe /></CheckDecisionsHost>);
      expect(shown()).not.toContain(answered);
      expect(held()).toBe(answered);
      const other = bootstrap("2026-10-20");
      runtime.value = { ...runtime.value, canonicalShellData: other, data: other, shellData: other };
      view.rerender(<CheckDecisionsHost><Probe /></CheckDecisionsHost>);
      expect(shown()).not.toContain(answered);
      expect(held()).toBe(answered);
      // Still held for Undo: nothing has been sent yet.
      expect(clientFetch.mock.calls.some(([url]) => String(url).startsWith("/api/review/") && url !== "/api/review/presentation")).toBe(false);
    });
});
