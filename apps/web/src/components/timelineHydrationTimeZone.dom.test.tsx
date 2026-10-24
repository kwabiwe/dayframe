// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData } from "@/lib/queries";

/**
 * /timeline is server-rendered in UTC (Vercel) and hydrated in the viewer's zone. Each side loads
 * its own copy of the modules under its own zone, as two separate processes would, so module-level
 * formatters resolve the zone they would in production.
 */

const navigation = vi.hoisted(() => ({ search: "" }));

const runtime = vi.hoisted(() => {
  const values: Record<string, unknown> = {
    dateLoadError: null,
    isDateLoading: false,
    isTimerBusy: false,
    shellData: null
  };
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

// 00:45 BST on Monday 12 October 2026, which is still Sunday the 11th in UTC.
const RENDERED_AT = "2026-10-11T23:45:00.000Z";
// 00:30–01:15 BST on Monday: 23:30 UTC on Sunday.
const LATE_CALL = { id: "80000000-0000-4000-8000-000000000001", startedAt: "2026-10-11T23:30:00.000Z", stoppedAt: "2026-10-12T00:15:00.000Z" };
const WEDNESDAY = { id: "80000000-0000-4000-8000-000000000002", startedAt: "2026-10-14T13:00:00.000Z", stoppedAt: "2026-10-14T14:00:00.000Z" };
const originalTimeZone = process.env.TZ;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

async function loadUnder(zone: string) {
  process.env.TZ = zone;
  vi.resetModules();
  const [react, client, server, views] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("react-dom/server"),
    import("./TimeReviewViews")
  ]);
  return { ...react, ...client, ...server, TimeReviewViews: views.TimeReviewViews };
}

async function serverHtml(zone: string, initialTodayKey: string | null) {
  const side = await loadUnder(zone);
  return side.renderToString(side.createElement(side.TimeReviewViews, {
    initialData: bootstrap(),
    initialPreference: null,
    initialTodayKey,
    renderedAt: RENDERED_AT
  }));
}

async function hydrateFromUtc(view: "calendar" | "list", initialTodayKey: string | null, date = "2026-10-12") {
  navigation.search = `date=${date}&scope=week&view=${view}`;
  window.history.replaceState(null, "", `/timeline?${navigation.search}`);
  window.sessionStorage.clear();
  installDom();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(RENDERED_AT));
  const html = await serverHtml("UTC", initialTodayKey);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);

  // The browser, in London, a few seconds later.
  vi.setSystemTime(new Date(Date.parse(RENDERED_AT) + 5_000));
  const browser = await loadUnder("Europe/London");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const recoverable: unknown[] = [];
  let root: ReturnType<typeof browser.hydrateRoot> | undefined;
  await browser.act(async () => {
    root = browser.hydrateRoot(container, browser.createElement(browser.TimeReviewViews, {
      initialData: bootstrap(),
      initialPreference: null,
      initialTodayKey,
      renderedAt: RENDERED_AT
    }), { onRecoverableError: (error) => recoverable.push(error) });
  });
  return {
    container,
    html,
    recoverable,
    unmount: () => browser.act(async () => root?.unmount())
  };
}

describe("/timeline renders browser-local times after hydration (UTC server, London browser)", () => {
  it("draws the same first render whatever the server's zone", async () => {
    navigation.search = "date=2026-10-12&scope=week&view=calendar";
    installDom();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(RENDERED_AT));
    const utc = await serverHtml("UTC", "2026-10-12");
    const london = await serverHtml("Europe/London", "2026-10-12");
    expect(london).toBe(utc);
  });

  it("hydrates the Calendar near midnight without a mismatch, then places blocks on the viewer's days", async () => {
    const { container, html, recoverable, unmount } = await hydrateFromUtc("calendar", "2026-10-12");

    // The server drew the frame only: no blocks, now line or clock times.
    expect(html).not.toContain("calendar-time-block");
    expect(html).not.toContain("calendar-now-line");
    expect(html).not.toMatch(/\b(23|00):(30|45)\b/);
    expect(html).toContain('data-calendar-day-key="2026-10-12"');
    // Calendar v3: the framed line under the strip, its date for assistive tech.
    expect(html).toContain("– framed");
    expect(html).toContain('aria-label="Framed on Monday 12 October"');

    expect(recoverable).toEqual([]);
    const monday = container.querySelector('[data-calendar-day-key="2026-10-12"]')!;
    const lateCall = monday.querySelector(`[data-entry-id="${LATE_CALL.id}"] .calendar-entry-primary`);
    expect(lateCall?.getAttribute("aria-label")).toContain("00:30");
    expect(container.querySelector(`[data-calendar-day-key="2026-10-11"] [data-entry-id="${LATE_CALL.id}"]`)).toBeNull();
    expect(container.querySelector(`[data-calendar-day-key="2026-10-14"] [data-entry-id="${WEDNESDAY.id}"] .calendar-entry-primary`)?.getAttribute("aria-label")).toContain("14:00");
    expect(monday.querySelector(".calendar-now-line")).not.toBeNull();
    // Future time (#369) follows the same post-hydration now: none of it in the server frame, then
    // the not-allowed zone starts exactly at the now line and later days are marked.
    expect(html).not.toContain("calendar-future-zone");
    expect(html).not.toContain("is-future");
    expect(monday.querySelector<HTMLElement>("[data-calendar-future-zone]")?.style.top)
      .toBe(monday.querySelector<HTMLElement>(".calendar-now-line")?.style.top);
    expect(container.querySelector('[data-calendar-day-key="2026-10-13"]')?.classList.contains("is-future")).toBe(true);
    expect(monday.classList.contains("is-future")).toBe(false);
    expect(container.querySelector(".calendar-day-heading.is-today")?.querySelector("[aria-label]")?.getAttribute("aria-label")).toContain("12 Oct");
    expect(container.querySelector(".calendar-grid-scroller")?.hasAttribute("aria-busy")).toBe(false);
    // 45 minutes on Monday (London) and an hour on Wednesday.
    expect(container.querySelector(".df-cal-weektotal")?.textContent).toBe("1h 45m this week");
    await unmount();
  });

  it("hydrates the List near midnight without a mismatch, then groups rows by the viewer's days", async () => {
    const { container, html, recoverable, unmount } = await hydrateFromUtc("list", "2026-10-12");

    expect(html).not.toContain("timeline-list-row");
    expect(html).not.toMatch(/\b(23|00):(30|45)\b/);

    expect(recoverable).toEqual([]);
    const headings = [...container.querySelectorAll(".timeline-list-day-heading")].map((row) => row.textContent);
    expect(headings).toEqual(["Wed 14 Oct1h", "Mon 12 Oct45m"]);
    const times = [...container.querySelectorAll<HTMLInputElement>(`[data-inline-entry-id="${LATE_CALL.id}"][data-inline-field="time"]`)].map((input) => input.value);
    expect(times).toEqual(["00:30", "01:15"]);
    await unmount();
  });

  it("still hydrates cleanly when the server's guess at today is wrong (no zone cookie yet)", async () => {
    // Without the cookie the server assumes UTC: Sunday the 11th, outside this week.
    const { container, html, recoverable, unmount } = await hydrateFromUtc("calendar", "2026-10-11");
    expect(html).toContain("timeline-today-button");
    expect(recoverable).toEqual([]);
    // The browser knows better once hydrated: this week holds today, so no Today button.
    expect(container.querySelector(".timeline-today-button")).toBeNull();
    expect(container.querySelector('[data-calendar-day-key="2026-10-12"] .calendar-now-line')).not.toBeNull();
    await unmount();
  });
});

describe("a first visit just after local midnight without the zone cookie (Codex r1 on #367)", () => {
  it("moves a bare /timeline from the server's UTC day to the browser's today, replacing the history entry", async () => {
    const loadDate = runtime.loadDate as ReturnType<typeof vi.fn>;
    loadDate.mockClear();
    // No cookie: the server assumed UTC, so bare /timeline was canonicalised to Sunday the 11th.
    const historyLength = window.history.length;
    const { recoverable, unmount } = await hydrateFromUtc("calendar", "2026-10-11", "2026-10-11");
    expect(recoverable).toEqual([]);
    expect(loadDate).toHaveBeenCalledWith("2026-10-12");
    expect(new URLSearchParams(window.location.search).get("date")).toBe("2026-10-12");
    expect(window.history.length).toBe(historyLength);
    await unmount();
  });

  it("leaves a date the server did not pick as today where it is", async () => {
    const loadDate = runtime.loadDate as ReturnType<typeof vi.fn>;
    loadDate.mockClear();
    const { recoverable, unmount } = await hydrateFromUtc("calendar", "2026-10-11", "2026-10-05");
    expect(recoverable).toEqual([]);
    expect(loadDate).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get("date")).toBe("2026-10-05");
    await unmount();
  });

  it("keeps the date when the cookie gave the server the viewer's today", async () => {
    const loadDate = runtime.loadDate as ReturnType<typeof vi.fn>;
    loadDate.mockClear();
    const { unmount } = await hydrateFromUtc("calendar", "2026-10-12", "2026-10-12");
    expect(loadDate).not.toHaveBeenCalled();
    await unmount();
  });
});

function entry(fixture: { id: string; startedAt: string; stoppedAt: string }, description: string) {
  return {
    ...fixture,
    categoryId: null,
    categoryName: null,
    categoryColor: null,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description,
    updatedAt: fixture.stoppedAt,
    durationSeconds: (Date.parse(fixture.stoppedAt) - Date.parse(fixture.startedAt)) / 1000,
    tagNames: [],
    tags: []
  };
}

function installDom() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class { disconnect() {} observe() {} unobserve() {} }
  });
}

function bootstrap(): BootstrapData {
  const entries = [entry(LATE_CALL, "Late call"), entry(WEDNESDAY, "Planning")];
  return {
    activeEntry: null,
    user: { id: "user", email: "user@example.test", name: "Test User", dailyGoalMinutes: 480, weeklyGoalMinutes: 2400 },
    workspace: { id: "workspace", name: "Dayframe" },
    workspaces: [{ id: "workspace", name: "Dayframe" }],
    categories: [],
    categoryUsage: [],
    clients: [],
    projects: [],
    tags: [],
    places: [],
    learnedPlaces: [],
    automationRules: [],
    taskSuggestions: [],
    reviewItems: [],
    activityEvents: [],
    entries,
    historyEntries: entries,
    dayEntries: entries,
    weekEntries: entries,
    stats: { todaySeconds: 0, weekSeconds: 0, todayCoveredSeconds: 0, weekCoveredSeconds: 0, todayAdditionalOverlapSeconds: 0, weekAdditionalOverlapSeconds: 0, reviewCount: 0, reviewCardCount: 0 },
    todaySeries: [],
    weekSeries: [],
    dateRange: {
      selectedDate: "2026-10-12",
      previousDate: "2026-10-11",
      nextDate: "2026-10-13",
      dayStart: "2026-10-12T00:00:00.000Z",
      dayEnd: "2026-10-13T00:00:00.000Z",
      weekStart: "2026-10-12T00:00:00.000Z",
      weekEnd: "2026-10-19T00:00:00.000Z"
    }
  } as unknown as BootstrapData;
}
