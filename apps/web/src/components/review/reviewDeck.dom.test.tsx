// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, ReviewItemRow } from "@/lib/queries";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined })
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => <a href={href} {...props}>{children}</a>
}));

type Sent = { url: string; body: { clientMutationId: string; mutation: Record<string, unknown> }; keepalive?: boolean };
const sent: Sent[] = [];
const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  if (init?.method === "POST" && input.startsWith("/api/review/")) {
    const body = JSON.parse(String(init.body)) as Sent["body"];
    sent.push({ url: input, body, keepalive: init.keepalive });
    const reviewItemId = input.slice("/api/review/".length);
    const action = body.mutation.action as string;
    const ignored = action.startsWith("ignore");
    return new Response(JSON.stringify({
      ok: true,
      action,
      status: ignored ? "ignored" : "accepted",
      ...(ignored ? {} : { entryId: "e-1" }),
      clientMutationId: body.clientMutationId,
      reviewItemId
    }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
});

vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: (input: string, init?: RequestInit) => fetchMock(input, init)
}));

const { AppShellRuntimeProvider } = await import("@/components/AppShellRuntime");
const { ReviewDeck } = await import("./ReviewDeck");

const local = (hour: number, minute = 0) => new Date(2026, 7, 17, hour, minute).toISOString();
const NOW = new Date(2026, 7, 17, 12, 0);
const WALK = "30000000-0000-4000-8000-000000000001";
const READ = "30000000-0000-4000-8000-000000000002";

afterEach(() => {
  vi.useRealTimers();
  fetchMock.mockClear();
  sent.length = 0;
  document.body.innerHTML = "";
});

async function mount(items = [review(WALK, "Morning walk", "focus"), review(READ, "Reading", "admin")]) {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(
    <AppShellRuntimeProvider>
      <ReviewDeck initialData={bootstrap(items)} />
    </AppShellRuntimeProvider>
  ));
  return { container, root };
}

function key(key: string, target: EventTarget = document.body) {
  return act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

const title = (container: HTMLElement) => container.querySelector("#df-rcard-title")?.textContent;
const queue = (container: HTMLElement) => [...container.querySelectorAll(".df-qrow b")].map((node) => node.textContent);

describe("Review", () => {
  it("holds Log it for Undo: the card leaves, the toast offers Undo, and Undo sends nothing", async () => {
    const { container, root } = await mount();
    expect(title(container)).toBe("Morning walk");
    expect(queue(container)).toEqual(["Morning walk", "Reading"]);

    await key("y");
    expect(title(container)).toBe("Reading");
    expect(queue(container)).toEqual(["Reading"]);
    const toast = container.querySelector(".df-toast");
    expect(toast?.textContent).toContain("Logged Morning walk");

    await act(async () => toast!.querySelector<HTMLButtonElement>(".df-toast-action")!.click());
    expect(title(container)).toBe("Morning walk");
    expect(queue(container)).toEqual(["Morning walk", "Reading"]);
    await act(async () => vi.advanceTimersByTime(6_000));
    expect(sent).toEqual([]);
    await act(async () => root.unmount());
  });

  it("sends the plain accept when the hold ends, and Skip sends ignore_once", async () => {
    const { container, root } = await mount();
    await key("y");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(sent.map((request) => [request.url, request.body.mutation])).toEqual([[`/api/review/${WALK}`, { action: "accept" }]]);
    expect(sent[0].body.clientMutationId).toMatch(/^[0-9a-f-]{36}$/);

    await key("n");
    // A new decision is held; the next one is not sent before its own window ends.
    expect(sent).toHaveLength(1);
    expect(container.querySelector(".df-done h2")?.textContent).toBe("All framed");
    expect(container.querySelector(".df-done p")?.textContent).toContain("1 moment logged, 1h added to your days");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(sent[1].body.mutation).toEqual({ action: "ignore_once" });
    await act(async () => root.unmount());
  });

  it("logs the typed name and picked activity as edit_and_confirm", async () => {
    const { container, root } = await mount();
    await key("e");
    const input = container.querySelector<HTMLInputElement>("#df-logas-name")!;
    expect(document.activeElement).toBe(input);
    // Typing in the field never triggers Y / N.
    await key("n", input);
    expect(title(container)).toBe("Morning walk");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Park run");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const admin = [...container.querySelectorAll<HTMLButtonElement>("[role='radio']")].find((chip) => chip.textContent === "Admin")!;
    await act(async () => admin.click());
    expect(admin.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(container.querySelector(".df-toast")?.textContent).toContain("Logged Park run");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(sent[0].body.mutation).toEqual({
      action: "edit_and_confirm",
      edit: { categoryId: "admin", description: "Park run", startedAt: local(7), stoppedAt: local(8) }
    });
    await act(async () => root.unmount());
  });

  it("moves through the queue with ↑ ↓ and saves a held decision when Review is left", async () => {
    const { container, root } = await mount();
    await key("ArrowDown");
    expect(title(container)).toBe("Reading");
    await key("ArrowDown");
    expect(title(container)).toBe("Morning walk");
    await key("ArrowUp");
    expect(title(container)).toBe("Reading");
    await key("n");
    await act(async () => root.unmount());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(sent.map((request) => [request.url, request.body.mutation, request.keepalive])).toEqual([
      [`/api/review/${READ}`, { action: "ignore_once" }, true]
    ]);
  });

  it("cannot log a moment without a complete window but can skip it", async () => {
    const { container, root } = await mount([{ ...review(WALK, "Morning walk", "focus"), suggestedStoppedAt: null }]);
    const logIt = [...container.querySelectorAll<HTMLButtonElement>(".df-ractions button")].find((button) => button.textContent?.startsWith("Log it"))!;
    expect(logIt.disabled).toBe(true);
    expect(container.querySelector("#df-logas-name")).toBeNull();
    await key("y");
    expect(title(container)).toBe("Morning walk");
    await key("n");
    expect(container.querySelector(".df-done")).not.toBeNull();
    await act(async () => root.unmount());
  });
});

function review(id: string, title: string, categoryId: string): ReviewItemRow {
  return {
    id,
    type: "suggestion",
    title,
    eventSource: "health_workout",
    eventType: "health_workout",
    projectName: null,
    categoryName: categoryId === "focus" ? "Focus" : "Admin",
    categoryColor: categoryId === "focus" ? "mint" : "steel",
    placeName: null,
    suggestedProjectId: null,
    suggestedCategoryId: categoryId,
    suggestedPlaceId: null,
    suggestedStartedAt: id === WALK ? local(7) : local(9),
    suggestedStoppedAt: id === WALK ? local(8) : local(9, 30),
    confidence: "medium",
    status: "open",
    notes: null,
    rawPayload: null,
    createdAt: local(10)
  };
}

function bootstrap(reviewItems: ReviewItemRow[]): BootstrapData {
  return {
    activeEntry: null,
    user: { id: "user", email: "user@example.test", name: "Test User", dailyGoalMinutes: 480, weeklyGoalMinutes: 2400 },
    workspace: { id: "workspace", name: "Dayframe" },
    workspaces: [{ id: "workspace", name: "Dayframe" }],
    categories: [
      { id: "focus", name: "Focus", color: "mint", isPinned: true },
      { id: "admin", name: "Admin", color: "steel", isPinned: false }
    ],
    categoryUsage: [],
    tags: [],
    taskSuggestions: [],
    reviewItems,
    stats: { todaySeconds: 0, weekSeconds: 0, todayCoveredSeconds: 0, weekCoveredSeconds: 0, todayAdditionalOverlapSeconds: 0, weekAdditionalOverlapSeconds: 0, reviewCount: reviewItems.length },
    activityEvents: [],
    entries: [],
    historyEntries: [],
    dayEntries: [],
    weekEntries: [],
    dateRange: {
      selectedDate: "2026-08-17",
      dayStart: local(0),
      dayEnd: new Date(2026, 7, 18).toISOString(),
      weekStart: local(0),
      weekEnd: new Date(2026, 7, 24).toISOString()
    }
  } as unknown as BootstrapData;
}
