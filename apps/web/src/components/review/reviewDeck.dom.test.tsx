// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, ReviewItemRow } from "@/lib/queries";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined })
}));

// The real editor loads private evidence; a stub lets a test confirm (onResolved, then onClose) or close it.
vi.mock("@/components/location/LocationReviewPanel", () => ({
  LocationReviewPanel: ({ onClose, onResolved }: { onClose: () => void; onResolved?: () => void }) => (
    <div>
      <button type="button" onClick={() => { onResolved?.(); onClose(); }}>Stub confirm</button>
      <button type="button" onClick={onClose}>Stub close</button>
    </div>
  )
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => <a href={href} {...props}>{children}</a>
}));

type Sent = { url: string; body: { clientMutationId: string; mutation: Record<string, unknown> }; keepalive?: boolean };
const sent: Sent[] = [];
// A test may answer a Review POST itself (another device's decision, a failure).
let answer: ((body: Sent["body"]) => Response | undefined) | null = null;
const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  if (init?.method === "POST" && input.startsWith("/api/review/")) {
    const body = JSON.parse(String(init.body)) as Sent["body"];
    sent.push({ url: input, body, keepalive: init.keepalive });
    const answered = answer?.(body);
    if (answered) return answered;
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
const { beforeSessionChange } = await import("@/lib/session-change");

const local = (hour: number, minute = 0) => new Date(2026, 7, 17, hour, minute).toISOString();
const NOW = new Date(2026, 7, 17, 12, 0);
const WALK = "30000000-0000-4000-8000-000000000001";
const READ = "30000000-0000-4000-8000-000000000002";

afterEach(() => {
  vi.useRealTimers();
  fetchMock.mockClear();
  sent.length = 0;
  answer = null;
  window.location.hash = "";
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

describe("Review review-round fixes", () => {
  it("keeps Enter for an input method and modified Enter from logging", async () => {
    const { container, root } = await mount();
    const input = container.querySelector<HTMLInputElement>("#df-logas-name")!;
    input.focus();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }));
    });
    expect(title(container)).toBe("Morning walk");
    expect(container.querySelector(".df-toast")).toBeNull();
    await act(async () => root.unmount());
  });

  it("drops a moment decided differently elsewhere quietly, and does not count an equivalent one", async () => {
    answer = (body) => body.mutation.action === "ignore_once"
      ? new Response(JSON.stringify({ ok: false, code: "resolution_conflict", canonicalStatus: "accepted" }), { status: 409 })
      : new Response(JSON.stringify({ ok: true, action: "accept", status: "accepted", alreadyResolved: true, equivalent: true }), { status: 200 });
    const { container, root } = await mount();
    await key("n");
    await key("y");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(sent.map((request) => request.body.mutation.action)).toEqual(["ignore_once", "accept"]);
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(queue(container)).toEqual([]);
    expect(container.querySelector(".df-done p")?.textContent).toContain("Nothing to review");
    await act(async () => root.unmount());
  });

  it("saves a held decision before the session changes (workspace switch or log out)", async () => {
    const { root } = await mount();
    await key("y");
    expect(sent).toEqual([]);
    await act(async () => beforeSessionChange());
    expect(sent.map((request) => request.body.mutation)).toEqual([{ action: "accept" }]);
    await act(async () => root.unmount());
  });

  it("says when a linked moment is not in the queue instead of opening another silently", async () => {
    window.location.hash = "#review-30000000-0000-4000-8000-000000000099";
    const { container, root } = await mount();
    expect(container.textContent).toContain("That moment isn’t waiting here");
    await act(async () => root.unmount());
    window.location.hash = `#review-${READ}`;
    const second = await mount();
    expect(title(second.container)).toBe("Reading");
    expect(second.container.textContent).not.toContain("That moment isn’t waiting here");
    await act(async () => second.root.unmount());
  });

  it("moves focus to All framed after the last decision and back to the card after Undo", async () => {
    const { container, root } = await mount([review(WALK, "Morning walk", "focus")]);
    const logIt = container.querySelector<HTMLButtonElement>(".df-ractions button")!;
    logIt.focus();
    await act(async () => logIt.click());
    expect(document.activeElement).toBe(container.querySelector("#df-done-title"));
    const undoButton = container.querySelector<HTMLButtonElement>(".df-toast-action")!;
    undoButton.focus();
    await act(async () => undoButton.click());
    await act(async () => vi.advanceTimersByTimeAsync(20));
    expect(document.activeElement?.textContent).toContain("Log it");
    await act(async () => root.unmount());
  });

  it("leaves Y, N and ⌘Z to the evidence editor while it is open", async () => {
    const visit = { ...review(WALK, "Visit", "focus"), eventSource: "location_learning", eventType: "learned_place_visit", rawPayload: { algorithmVersion: "location-v2.0" } };
    const { container, root } = await mount([visit, review(READ, "Reading", "admin")]);
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>(".df-qrow")][1].click();
    });
    await key("n");
    expect(container.querySelector(".df-toast")?.textContent).toContain("Skipped Reading");
    const edit = [...container.querySelectorAll<HTMLButtonElement>(".df-ractions button")].find((button) => button.textContent === "Edit before logging")!;
    await act(async () => edit.click());
    expect(edit.getAttribute("aria-expanded")).toBe("true");
    const n = new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true });
    const undoKey = new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true });
    await act(async () => {
      edit.dispatchEvent(n);
      edit.dispatchEvent(undoKey);
    });
    // N is swallowed (the shell's command bar does not take it either); ⌘Z does not undo.
    expect(n.defaultPrevented).toBe(true);
    expect(queue(container)).toEqual(["Visit"]);
    expect(container.querySelector(".df-revidence")).not.toBeNull();
    await act(async () => root.unmount());
  });
});

describe("Review round-2 fixes", () => {
  it("lets neither Enter in Log as nor Shift+arrows on the chips act while the evidence editor is open", async () => {
    const visit = { ...review(WALK, "Visit", "focus"), eventSource: "location_learning", eventType: "learned_place_visit", rawPayload: { algorithmVersion: "location-v2.0" } };
    const { container, root } = await mount([visit, review(READ, "Reading", "admin")]);
    const focusChip = container.querySelector<HTMLButtonElement>("[role='radio'][aria-checked='true']")!;
    await act(async () => {
      focusChip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(container.querySelector("[role='radio'][aria-checked='true']")?.textContent).toBe("Focus");
    const edit = [...container.querySelectorAll<HTMLButtonElement>(".df-ractions button")].find((button) => button.textContent === "Edit before logging")!;
    await act(async () => edit.click());
    const input = container.querySelector<HTMLInputElement>("#df-logas-name")!;
    expect(input.readOnly).toBe(true);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(title(container)).toBe("Visit");
    expect(container.querySelector(".df-toast")).toBeNull();
    expect(container.querySelector(".df-revidence")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("hands focus from an expiring Undo to the card", async () => {
    const { container, root } = await mount();
    await key("y");
    const undoButton = container.querySelector<HTMLButtonElement>(".df-toast-action")!;
    undoButton.focus();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(document.activeElement?.textContent).toContain("Log it");
    expect(title(container)).toBe("Reading");
    await act(async () => root.unmount());
  });

  it("does not celebrate again when a refilled queue empties without this visit", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (items: ReviewItemRow[]) => act(async () => root.render(
      <AppShellRuntimeProvider>
        <ReviewDeck initialData={bootstrap(items)} />
      </AppShellRuntimeProvider>
    ));
    await render([review(WALK, "Morning walk", "focus")]);
    await key("y");
    expect(container.querySelector(".df-done.is-celebrating")).not.toBeNull();
    await render([review(WALK, "Morning walk", "focus"), review(READ, "Reading", "admin")]);
    expect(title(container)).toBe("Reading");
    await render([review(WALK, "Morning walk", "focus")]);
    expect(container.querySelector(".df-done")).not.toBeNull();
    expect(container.querySelector(".df-done.is-celebrating")).toBeNull();
    await act(async () => root.unmount());
  });
});

describe("Review round-3 fixes", () => {
  it("brings an undone card back to the queue without closing another card's evidence editor", async () => {
    const visit = { ...review(READ, "Visit", "admin"), eventSource: "location_learning", eventType: "learned_place_visit", rawPayload: { algorithmVersion: "location-v2.0" } };
    const { container, root } = await mount([review(WALK, "Morning walk", "focus"), visit]);
    await key("n");
    expect(title(container)).toBe("Visit");
    const edit = [...container.querySelectorAll<HTMLButtonElement>(".df-ractions button")].find((button) => button.textContent === "Edit before logging")!;
    await act(async () => edit.click());
    await act(async () => container.querySelector<HTMLButtonElement>(".df-toast-action")!.click());
    await act(async () => vi.advanceTimersByTimeAsync(20));
    expect(queue(container)).toEqual(["Morning walk", "Visit"]);
    expect(title(container)).toBe("Visit");
    expect(container.querySelector(".df-revidence")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("keeps focus in the deck when a decision removes the focused row or replaces the focused toast", async () => {
    const { container, root } = await mount([review(WALK, "Morning walk", "focus"), review(READ, "Reading", "admin"), { ...review(WALK, "Third", "focus"), id: "30000000-0000-4000-8000-000000000003" }]);
    const row = container.querySelectorAll<HTMLButtonElement>(".df-qrow")[0];
    row.focus();
    await key("y", row);
    await act(async () => vi.advanceTimersByTimeAsync(20));
    expect(document.activeElement?.textContent).toContain("Log it");
    const undoButton = container.querySelector<HTMLButtonElement>(".df-toast-action")!;
    undoButton.focus();
    await key("n", undoButton);
    await act(async () => vi.advanceTimersByTimeAsync(20));
    expect(document.activeElement?.closest(".df-ractions")).not.toBeNull();
    await act(async () => root.unmount());
  });
});

describe("Review round-4 fixes", () => {
  async function controllable(items: ReviewItemRow[]) {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (next: ReviewItemRow[], reviewCount = next.length) => act(async () => root.render(
      <AppShellRuntimeProvider>
        <ReviewDeck initialData={bootstrap(next, reviewCount)} />
      </AppShellRuntimeProvider>
    ));
    await render(items);
    return { container, root, render };
  }

  it("logs once for a held Enter", async () => {
    const { container, root } = await mount();
    const input = container.querySelector<HTMLInputElement>("#df-logas-name")!;
    input.focus();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true }));
    });
    expect(title(container)).toBe("Reading");
    expect(queue(container)).toEqual(["Reading"]);
    await act(async () => root.unmount());
  });

  it("decides once for a held Enter on Log it or Skip", async () => {
    const { container, root } = await mount();
    const logIt = container.querySelector<HTMLButtonElement>(".df-ractions button")!;
    const held = new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true });
    logIt.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
    const first = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    logIt.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(false);
    await act(async () => root.unmount());
  });

  it("counts a kept card once in the moments line", async () => {
    const visit = { ...review(WALK, "Visit", "focus"), eventSource: "location_learning", eventType: "learned_place_visit", rawPayload: { algorithmVersion: "location-v2.0" } };
    const { container, root, render } = await controllable([visit, review(READ, "Reading", "admin")]);
    const edit = [...container.querySelectorAll<HTMLButtonElement>(".df-ractions button")].find((button) => button.textContent === "Edit before logging")!;
    await act(async () => edit.click());
    // The newest page no longer lists the visit, but the server still counts it (2 open).
    await render([review(READ, "Reading", "admin")], 2);
    expect(container.querySelector(".df-review-head p")?.textContent).toMatch(/^2 moments/);
    await act(async () => root.unmount());
  });

  it("keeps the card whose evidence editor is open when a capped refresh no longer lists it", async () => {
    const visit = { ...review(WALK, "Visit", "focus"), eventSource: "location_learning", eventType: "learned_place_visit", rawPayload: { algorithmVersion: "location-v2.0" } };
    const { container, root, render } = await controllable([visit, review(READ, "Reading", "admin")]);
    const edit = [...container.querySelectorAll<HTMLButtonElement>(".df-ractions button")].find((button) => button.textContent === "Edit before logging")!;
    await act(async () => edit.click());
    await render([review(READ, "Reading", "admin")]);
    expect(title(container)).toBe("Visit");
    expect(container.querySelector(".df-revidence")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("retires a revived card once its evidence editor saves, and keeps it when the editor is closed", async () => {
    const visit = { ...review(WALK, "Visit", "focus"), eventSource: "location_learning", eventType: "learned_place_visit", rawPayload: { algorithmVersion: "location-v2.0" } };
    const { container, root, render } = await controllable([visit, review(READ, "Reading", "admin")]);
    await key("y");
    await render([review(READ, "Reading", "admin")]);
    await act(async () => container.querySelector<HTMLButtonElement>(".df-toast-action")!.click());
    expect(queue(container)).toEqual(["Reading", "Visit"]);
    const openEditor = async () => {
      const edit = [...container.querySelectorAll<HTMLButtonElement>(".df-ractions button")].find((button) => button.textContent === "Edit before logging")!;
      await act(async () => edit.click());
    };
    await openEditor();
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Stub close")!.click());
    expect(queue(container)).toEqual(["Reading", "Visit"]);
    await openEditor();
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Stub confirm")!.click());
    expect(queue(container)).toEqual(["Reading"]);
    await act(async () => root.unmount());
  });

  it("does not count a held card the newest 100 no longer list", async () => {
    const { container, root, render } = await controllable([review(WALK, "Morning walk", "focus"), review(READ, "Reading", "admin")]);
    await key("y");
    // The server still counts the held card (2 open); the page lists only Reading now.
    await render([review(READ, "Reading", "admin")], 2);
    expect(container.querySelector(".df-review-head p")?.textContent).toMatch(/^1 moment /);
    await act(async () => root.unmount());
  });

  it("brings an undone card back although a capped refresh dropped it while held", async () => {
    const { container, root, render } = await controllable([review(WALK, "Morning walk", "focus"), review(READ, "Reading", "admin")]);
    await key("y");
    await render([review(READ, "Reading", "admin")]);
    await act(async () => container.querySelector<HTMLButtonElement>(".df-toast-action")!.click());
    expect(queue(container)).toEqual(["Reading", "Morning walk"]);
    expect(title(container)).toBe("Morning walk");
    await act(async () => vi.advanceTimersByTime(6_000));
    expect(sent).toEqual([]);
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

function bootstrap(reviewItems: ReviewItemRow[], reviewCount = reviewItems.length): BootstrapData {
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
    stats: { todaySeconds: 0, weekSeconds: 0, todayCoveredSeconds: 0, weekCoveredSeconds: 0, todayAdditionalOverlapSeconds: 0, weekAdditionalOverlapSeconds: 0, reviewCount },
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
