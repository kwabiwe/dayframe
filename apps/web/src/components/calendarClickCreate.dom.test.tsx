// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeEntryRow } from "@/lib/queries";

const runtime = vi.hoisted(() => ({
  clearTimerError: vi.fn(),
  createManualEntry: vi.fn(),
  isTimerBusy: false,
  startEntryAgain: vi.fn(),
  updateActiveEntryFromCalendar: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => runtime,
  useRuntimePageData: (value: unknown) => value
}));

const { CalendarEntryCompactEditor } = await import("./CalendarEntryCompactEditor");
const { CalendarReview } = await import("./TimeReviewViews");

let anchorIsOffscreen = false;
let dayBodyTop = 0;
let pointTarget: Element | null = null;
const capturedPointers = new WeakMap<Element, Set<number>>();
const outsidePointerListeners = new Set<EventListenerOrEventListenerObject>();
const nativeDocumentAdd = Document.prototype.addEventListener;
const nativeDocumentRemove = Document.prototype.removeEventListener;
const isCapture = (options?: boolean | AddEventListenerOptions | EventListenerOptions) =>
  options === true || (typeof options === "object" && Boolean(options.capture));
Document.prototype.addEventListener = function addEventListener(
  this: Document,
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions
) {
  if (type === "pointerdown" && listener && isCapture(options)) outsidePointerListeners.add(listener);
  return nativeDocumentAdd.call(this, type, listener as EventListenerOrEventListenerObject, options);
};
Document.prototype.removeEventListener = function removeEventListener(
  this: Document,
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | EventListenerOptions
) {
  if (type === "pointerdown" && listener && isCapture(options)) outsidePointerListeners.delete(listener);
  return nativeDocumentRemove.call(this, type, listener as EventListenerOrEventListenerObject, options);
};

describe("Calendar click-to-create DOM interactions", () => {
  beforeEach(() => {
    runtime.clearTimerError.mockReset();
    runtime.createManualEntry.mockReset().mockResolvedValue({ ok: true });
    runtime.startEntryAgain.mockReset().mockResolvedValue({ ok: true });
    runtime.updateActiveEntryFromCalendar.mockReset().mockResolvedValue({ ok: true });
    runtime.isTimerBusy = false;
    anchorIsOffscreen = false;
    dayBodyTop = 0;
    pointTarget = null;
    installDomGeometry();
  });

  afterEach(() => {
    // End any gesture a test left open so its window listeners never reach the next test.
    window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 0 }));
    cleanup();
    outsidePointerListeners.clear();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("keeps the exact busy draft and anchor through blank interaction, scroll-away, and a failed Save", async () => {
    const deferred = promiseController<{ ok: false; error: string }>();
    runtime.createManualEntry.mockReturnValueOnce(deferred.promise);
    renderCalendar();
    const dayBody = await openCreateAt(10 * 60 + 7);
    const editor = screen.getByTestId("calendar-compact-editor");
    const description = screen.getByLabelText("Description") as HTMLInputElement;
    await userEvent.type(description, "Failure probe");
    const anchor = document.querySelector<HTMLElement>("[data-calendar-draft]");
    expect(anchor).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Add block" }));
    await waitFor(() => expect(editor.getAttribute("aria-busy")).toBe("true"), { timeout: 5_000 });
    await flushDocumentListeners();

    anchorIsOffscreen = true;
    fireEvent.scroll(screen.getByLabelText("Calendar time grid"));
    const navigationCallback = vi.fn();
    window.addEventListener("keydown", navigationCallback);
    fireEvent.keyDown(description, { altKey: true, key: "ArrowRight" });
    window.removeEventListener("keydown", navigationCallback);
    await clickDay(dayBody, 12 * 60, 22);
    expect(screen.getByTestId("calendar-compact-editor")).toBe(editor);
    expect(document.querySelector("[data-calendar-draft]")).toBe(anchor);
    expect(description.value).toBe("Failure probe");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(navigationCallback).not.toHaveBeenCalled();

    await act(async () => deferred.resolve({ ok: false, error: "The entry could not be saved." }));
    const alert = await screen.findByRole("alert");
    expect(screen.getByTestId("calendar-compact-editor")).toBe(editor);
    expect(document.querySelector("[data-calendar-draft]")).toBe(anchor);
    expect(description.value).toBe("Failure probe");
    expect(alert.textContent).toContain("The entry could not be saved.");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
   }, 15_000);

  it("routes dirty scroll-away through one discard decision and restores the edited field focus", async () => {
    renderCalendar();
    await openCreateAt(9 * 60);
    const description = screen.getByLabelText("Description") as HTMLInputElement;
    await userEvent.type(description, "Keep this draft");
    anchorIsOffscreen = true;

    fireEvent.scroll(screen.getByLabelText("Calendar time grid"));
    const prompt = await screen.findByRole("alertdialog");
    expect(prompt.textContent).toContain("Discard unsaved changes?");
    fireEvent.scroll(screen.getByLabelText("Calendar time grid"));
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    await waitFor(() => expect(document.activeElement).toBe(description));
    fireEvent.scroll(screen.getByLabelText("Calendar time grid"));
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 10)));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(description.value).toBe("Keep this draft");
  });

  it("focuses create mode, preserves keyboard order, and returns focus to the Calendar", async () => {
    renderCalendar();
    await openCreateAt(8 * 60);
    const description = screen.getByLabelText("Description");
    const tags = screen.getByRole("button", { name: "Add or filter tags" });
    const category = screen.getByRole("button", { name: /All activities/ });
    await waitFor(() => expect(document.activeElement).toBe(description));

    await userEvent.tab();
    expect(document.activeElement).toBe(tags);
    await userEvent.tab();
    expect(document.activeElement).toBe(category);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(tags);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(description);

    await userEvent.click(category);
    expect(category.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(category.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(category);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("calendar-compact-editor")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Calendar time grid")));
  });

  it("creates a tag inside Description and includes it in the click-created entry", async () => {
    renderCalendar([], [{ id: "planning", name: "Planning", normalizedName: "planning", usageCount: 1 }]);
    await openCreateAt(8 * 60);
    await userEvent.click(screen.getByRole("button", { name: "Add or filter tags" }));
    const picker = await screen.findByRole("listbox", { name: "Tags" });
    const search = screen.getByRole("combobox", { name: "Search tags" });
    await userEvent.type(search, "New tag");
    await userEvent.click(within(picker).getByRole("option", { name: "Create “#New tag”" }));
    await userEvent.click(screen.getByRole("button", { name: "Add block" }));

    await waitFor(() => expect(runtime.createManualEntry).toHaveBeenCalledOnce());
    expect(runtime.createManualEntry).toHaveBeenCalledWith(expect.objectContaining({ tagNames: ["New tag"] }));
  });

  it("does not reset or replace a dirty editor when the selected block is double-clicked", async () => {
    renderCalendar([entryAt("2026-08-02T09:00:00.000Z", "2026-08-02T09:30:00.000Z")]);
    const block = document.querySelector<HTMLButtonElement>(".calendar-entry-primary") as HTMLButtonElement;
    await userEvent.click(block);
    const editor = await screen.findByTestId("calendar-compact-editor");
    const description = screen.getByLabelText("Description") as HTMLInputElement;
    await userEvent.clear(description);
    await userEvent.type(description, "Dirty draft");

    await userEvent.dblClick(block);
    expect(screen.getByTestId("calendar-compact-editor")).toBe(editor);
    expect(description.value).toBe("Dirty draft");
  });

  it("keeps the consumed pointer through React pointerup so the first blank click only dismisses", async () => {
    renderCalendar();
    const dayBody = await openCreateAt(8 * 60);
    await flushDocumentListeners();

    await clickDay(dayBody, 9 * 60, 31);
    await waitFor(() => expect(screen.queryByTestId("calendar-compact-editor")).toBeNull());

    await clickDay(dayBody, 9 * 60, 32);
    expect(await screen.findByTestId(
      "calendar-compact-editor",
      undefined,
      { timeout: 5_000 }
    )).not.toBeNull();
    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("09:00");
    // The inner wait alone may take 5s; the test limit must exceed it under parallel CI load.
  }, 15_000);

  it("repositions with a same-duration moved anchor and keeps a real overlapping entry above it", async () => {
    renderCalendar([entryAt("2026-08-02T11:00:00.000Z", "2026-08-02T11:30:00.000Z")]);
    await openCreateAt(10 * 60);
    const editor = screen.getByTestId("calendar-compact-editor");
    const initialEditorTop = Number.parseFloat(editor.style.top);
    const anchor = document.querySelector<HTMLElement>("[data-calendar-draft]") as HTMLElement;
    const initialHeight = Number.parseFloat(anchor.style.height);

    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "11:00" } });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "11:30" } });
    await waitFor(() => expect(Number.parseFloat(anchor.style.top)).toBe(11 * 64));
    await waitFor(() => expect(Number.parseFloat(editor.style.top)).toBeGreaterThan(initialEditorTop));
    expect(Number.parseFloat(anchor.style.height)).toBe(initialHeight);

    const realEntry = document.querySelector<HTMLElement>("[data-calendar-block-key]") as HTMLElement;
    expect(Number(anchor.style.zIndex)).toBeLessThan(Number(realEntry.style.zIndex));
  });

  it("allows a completed-entry PATCH Save while an unrelated timer mutation is busy", async () => {
    const anchor = document.createElement("article");
    anchor.className = "calendar-time-block";
    document.body.append(anchor);
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    const onDismiss = vi.fn();
    render(createElement(CalendarEntryCompactEditor, {
      anchor,
      capturedNow: new Date("2026-08-03T12:00:00.000Z"),
      categories: [],
      entry: entryAt("2026-08-02T10:00:00.000Z", "2026-08-02T10:30:00.000Z"),
      focusOnOpen: true,
      isTimerBusy: true,
      mode: "entry",
      onDelete: vi.fn(),
      onDismiss,
      onSave,
      onStartAgain: vi.fn().mockResolvedValue({ ok: true }),
      peerEntries: [],
      positionKey: "completed-entry",
      scrollContainer: null
    }));
    const description = await screen.findByLabelText("Description");
    fireEvent.change(description, { target: { value: "Completed edit" } });
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);

    await userEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onDismiss).toHaveBeenCalledWith({ restoreFocus: true });
  });

  it("keeps a short block full width when its drawn edge only touches the next block (Codex r2 on #545)", () => {
    const content = { categoryColor: "#64748b", categoryId: "work", categoryName: "Work", tagNames: [] };
    renderCalendar([
      entryAt("2026-08-02T09:00:00.000Z", "2026-08-02T09:04:00.000Z", { ...content, id: "coffee", description: "Coffee" }),
      entryAt("2026-08-02T09:15:00.000Z", "2026-08-02T10:00:00.000Z", { ...content, id: "work", description: "Work" })
    ]);
    // Coffee is drawn 16 px (to 09:15 at 64 px an hour); its semantic 17 px would reach 1 px into Work.
    for (const id of ["coffee", "work"]) {
      expect(document.querySelector<HTMLElement>(`[data-entry-id="${id}"]`)?.dataset.overlapLayout).toBe("full");
    }
  });

  it("titles every block with its real length and adds the detail line from 34 px (location v4 C6)", () => {
    const content = {
      categoryColor: "#64748b",
      categoryId: "work",
      categoryName: "Work",
      tagNames: ["Planning", "Review", "Deep work"]
    };
    renderCalendar([
      entryAt("2026-08-02T07:00:00.000Z", "2026-08-02T07:04:00.000Z", {
        ...content,
        id: "tiny-entry",
        description: "Coffee"
      }),
      entryAt("2026-08-02T08:00:00.000Z", "2026-08-02T08:30:00.000Z", {
        ...content,
        id: "medium-entry",
        description: "Medium block"
      }),
      entryAt("2026-08-02T09:00:00.000Z", "2026-08-02T10:00:00.000Z", {
        ...content,
        id: "full-entry",
        description: "Full block"
      })
    ]);

    for (const [id, title, length] of [
      ["tiny-entry", "Coffee", "4m"],
      ["medium-entry", "Medium block", "30m"],
      ["full-entry", "Full block", "1h"]
    ] as const) {
      const block = document.querySelector<HTMLElement>(`[data-entry-id="${id}"]`) as HTMLElement;
      const line = block.querySelector<HTMLElement>(".calendar-entry-title-line") as HTMLElement;
      expect(line.querySelector(".calendar-entry-title")?.textContent).toBe(title);
      expect(line.querySelector(".calendar-entry-length")?.textContent).toBe(length);
      expect(line.textContent).toBe(`${title} ${length}`);
      expect(block.querySelector(".calendar-entry-glyph svg")).not.toBeNull();
      // Activity, tags and times stay in the block's name for screen readers and the tooltip.
      expect(block.querySelector(".calendar-entry-primary")?.getAttribute("aria-label")).toContain(`${title} · Work · #Planning +2.`);
    }

    const tiny = document.querySelector<HTMLElement>('[data-entry-id="tiny-entry"]') as HTMLElement;
    const medium = document.querySelector<HTMLElement>('[data-entry-id="medium-entry"]') as HTMLElement;
    const full = document.querySelector<HTMLElement>('[data-entry-id="full-entry"]') as HTMLElement;
    // A 4-minute block is drawn one 16 px label line tall at 64 px an hour (17 px with its gap).
    expect(tiny.dataset.calendarSemanticHeight).toBe("17");
    expect(tiny.style.height).toBe("16px");
    expect(medium.dataset.calendarSemanticHeight).toBe("32");
    expect(full.dataset.calendarSemanticHeight).toBe("64");
    expect(tiny.className).toContain("is-tiny");
    expect(tiny.querySelector(".calendar-entry-detail-line")).toBeNull();
    expect(medium.querySelector(".calendar-entry-detail-line")).toBeNull();
    expect(full.querySelector(".calendar-entry-detail-line")?.textContent).toMatch(/^Work · .+–.+$/);
  });
});

function renderCalendar(entries: TimeEntryRow[] = [], tags: Array<{
  id: string;
  name: string;
  normalizedName: string;
  usageCount: number;
}> = []) {
  return render(createElement(CalendarReview, {
    calendarHoursMode: "fullDay",
    // Late on the shown day in every time zone: Calendar creates only before the now it shows.
    capturedNow: new Date(2026, 7, 2, 23, 0, 0, 0),
    categories: [],
    entries,
    onDeleteEntries: vi.fn(),
    onScroll: vi.fn(),
    onSynced: vi.fn().mockResolvedValue(undefined),
    places: [],
    scrollContainerRef: vi.fn(),
    tags,
    visibleDays: [new Date(2026, 7, 2, 12, 0, 0, 0)]
  }));
}

async function openCreateAt(minute: number) {
  const dayBody = document.querySelector<HTMLElement>("[data-calendar-day-body]") as HTMLElement;
  await clickDay(dayBody, minute, 11);
  await screen.findByTestId("calendar-compact-editor");
  await flushDocumentListeners();
  return dayBody;
}

async function clickDay(dayBody: HTMLElement, minute: number, pointerId: number) {
  pointTarget = dayBody;
  const clientY = (minute / 60) * 64;
  await act(async () => {
    fireEvent.pointerDown(dayBody, {
      button: 0,
      clientX: 300,
      clientY,
      isPrimary: true,
      pointerId,
      pointerType: "mouse"
    });
    fireEvent.pointerUp(dayBody, {
      button: 0,
      clientX: 300,
      clientY,
      isPrimary: true,
      pointerId,
      pointerType: "mouse"
    });
  });
}

// The compact editor installs its outside-press listener (document, capture) one macrotask after
// it opens. Wait for that exact registration instead of a timer race, so busy/parallel runs are
// deterministic.
async function flushDocumentListeners() {
  if (!editorIsOpen()) {
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
    return;
  }
  await waitFor(() => expect(outsidePointerListeners.size).toBeGreaterThan(0), { timeout: 5_000 });
}

function editorIsOpen() {
  return Boolean(document.querySelector("[data-testid='calendar-compact-editor']"));
}

function installDomGeometry() {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_200 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn()
    })
  });
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => pointTarget
  });
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: class ResizeObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
    }
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: window.ResizeObserver
  });
  Object.defineProperty(window, "PointerEvent", {
    configurable: true,
    value: class PointerEvent extends MouseEvent {
      isPrimary: boolean;
      pointerId: number;
      pointerType: string;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.isPrimary = init.isPrimary ?? true;
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? "";
      }
    }
  });
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    value: window.PointerEvent
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value(pointerId: number) {
      const ids = capturedPointers.get(this) ?? new Set<number>();
      ids.add(pointerId);
      capturedPointers.set(this, ids);
    }
  });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value(pointerId: number) {
      return capturedPointers.get(this)?.has(pointerId) ?? false;
    }
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value(pointerId: number) {
      capturedPointers.get(this)?.delete(pointerId);
    }
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function rect(this: HTMLElement) {
    if (this.classList.contains("calendar-grid-scroller")) return domRect(0, 0, 1_000, 850);
    if (this.matches("[data-calendar-day-body]")) return domRect(104, dayBodyTop, 800, 1_536);
    if (this.matches("[data-calendar-draft]")) {
      const top = anchorIsOffscreen ? 2_000 : Number.parseFloat(this.style.top || "0");
      return domRect(120, top, 760, Number.parseFloat(this.style.height || "1"));
    }
    if (this.matches("[data-calendar-block-key]")) {
      return domRect(120, Number.parseFloat(this.style.top || "0"), 760, Number.parseFloat(this.style.height || "1"));
    }
    if (this.classList.contains("calendar-compact-editor")) {
      return domRect(
        Number.parseFloat(this.style.left || "12"),
        Number.parseFloat(this.style.top || "12"),
        360,
        320
      );
    }
    return domRect(0, 0, 100, 44);
  });
}

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({})
  };
}

function promiseController<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function entryAt(
  startedAt: string,
  stoppedAt: string,
  overrides: Partial<TimeEntryRow> = {}
): TimeEntryRow {
  const durationSeconds = Math.floor((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1_000);
  return {
    id: `entry-${startedAt}`,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: null,
    categoryName: null,
    categoryColor: null,
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: "Existing entry",
    startedAt,
    stoppedAt,
    updatedAt: stoppedAt,
    durationSeconds,
    tagNames: [],
    tags: [],
    ...overrides
  };
}

const fetchMock = vi.hoisted(() => ({ clientFetch: vi.fn() }));
vi.mock("@/lib/client-auth-fetch", () => fetchMock);

describe("Calendar drag-to-create and 5-minute resize (W13)", () => {
  beforeEach(() => {
    runtime.createManualEntry.mockReset().mockResolvedValue({ ok: true });
    fetchMock.clientFetch.mockReset().mockResolvedValue({ ok: true, status: 200 });
    anchorIsOffscreen = false;
    dayBodyTop = 0;
    pointTarget = null;
    installDomGeometry();
  });

  afterEach(() => {
    // End any gesture a test left open so its window listeners never reach the next test.
    window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 0 }));
    cleanup();
    outsidePointerListeners.clear();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const y = (minute: number) => (minute / 60) * 64;
  const pointer = (pointerId: number, clientY: number) => ({
    button: 0, clientX: 300, clientY, isPrimary: true, pointerId, pointerType: "mouse"
  });

  it("follows the pointer with a 5-minute ghost and opens the create flow with the dragged times", async () => {
    renderCalendar();
    const dayBody = document.querySelector<HTMLElement>("[data-calendar-day-body]") as HTMLElement;
    pointTarget = dayBody;
    await act(async () => {
      fireEvent.pointerDown(dayBody, pointer(31, y(9 * 60 + 2)));
      fireEvent.pointerMove(dayBody, pointer(31, y(9 * 60 + 23)));
    });
    const ghost = document.querySelector<HTMLElement>("[data-calendar-create-ghost]");
    expect(ghost?.textContent).toMatch(/^09:00–09:25 · /);
    await act(async () => {
      fireEvent.pointerMove(dayBody, pointer(31, y(9 * 60 + 47)));
    });
    expect(document.querySelector("[data-calendar-create-ghost]")?.textContent).toMatch(/^09:00–09:45 · /);
    expect(screen.queryByTestId("calendar-compact-editor")).toBeNull();
    await act(async () => {
      fireEvent.pointerUp(dayBody, pointer(31, y(9 * 60 + 47)));
    });
    expect(document.querySelector("[data-calendar-create-ghost]")).toBeNull();
    await screen.findByTestId("calendar-compact-editor");
    await flushDocumentListeners();
    await userEvent.click(screen.getByRole("button", { name: "Add block" }));
    await waitFor(() => expect(runtime.createManualEntry).toHaveBeenCalledOnce());
    expect(runtime.createManualEntry).toHaveBeenCalledWith(expect.objectContaining({
      startedAt: new Date(2026, 7, 2, 9, 0).toISOString(),
      stoppedAt: new Date(2026, 7, 2, 9, 45).toISOString()
    }));
  });

  it("starts the ghost and the draft slot right of a bracketed day's rail, as its blocks do (location v3 PR 14b)", async () => {
    const schoolRun = { key: "trip-1", name: "School run", parts: 3 };
    const part = (from: [number, number], to: [number, number]) => entryAt(
      new Date(2026, 7, 2, ...from).toISOString(),
      new Date(2026, 7, 2, ...to).toISOString(),
      { source: "location_learning", locationGroup: schoolRun }
    );
    renderCalendar([part([6, 0], [6, 20]), part([6, 20], [7, 0]), part([7, 0], [7, 20])]);
    expect(document.querySelector(".df-cal-bracket")).not.toBeNull();
    const dayBody = document.querySelector<HTMLElement>("[data-calendar-day-body]") as HTMLElement;
    pointTarget = dayBody;
    await act(async () => {
      fireEvent.pointerDown(dayBody, pointer(41, y(9 * 60 + 2)));
      fireEvent.pointerMove(dayBody, pointer(41, y(9 * 60 + 47)));
    });
    expect(document.querySelector<HTMLElement>("[data-calendar-create-ghost]")?.style.left).toBe("20px");
    await act(async () => {
      fireEvent.pointerUp(dayBody, pointer(41, y(9 * 60 + 47)));
    });
    await screen.findByTestId("calendar-compact-editor");
    expect(document.querySelector<HTMLElement>("[data-calendar-draft]")?.style.left).toBe("20px");
  });

  it("leaves the ghost at the stylesheet's inset on a day without a bracket", async () => {
    renderCalendar();
    const dayBody = document.querySelector<HTMLElement>("[data-calendar-day-body]") as HTMLElement;
    pointTarget = dayBody;
    await act(async () => {
      fireEvent.pointerDown(dayBody, pointer(42, y(9 * 60 + 2)));
      fireEvent.pointerMove(dayBody, pointer(42, y(9 * 60 + 47)));
    });
    expect(document.querySelector<HTMLElement>("[data-calendar-create-ghost]")?.style.left).toBe("");
    await act(async () => {
      fireEvent.pointerUp(dayBody, pointer(42, y(9 * 60 + 47)));
    });
    await screen.findByTestId("calendar-compact-editor");
    expect(document.querySelector<HTMLElement>("[data-calendar-draft]")?.style.left).toBe("");
  });

  it("drags upward from the press and aborts cleanly on Escape and pointer cancel", async () => {
    renderCalendar();
    const dayBody = document.querySelector<HTMLElement>("[data-calendar-day-body]") as HTMLElement;
    pointTarget = dayBody;
    await act(async () => {
      fireEvent.pointerDown(dayBody, pointer(32, y(10 * 60)));
      fireEvent.pointerMove(dayBody, pointer(32, y(9 * 60 + 31)));
    });
    expect(document.querySelector("[data-calendar-create-ghost]")?.textContent).toMatch(/^09:30–10:00 · /);
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(document.querySelector("[data-calendar-create-ghost]")).toBeNull();
    await act(async () => {
      fireEvent.pointerUp(dayBody, pointer(32, y(9 * 60 + 31)));
    });
    await flushDocumentListeners();
    expect(screen.queryByTestId("calendar-compact-editor")).toBeNull();

    await act(async () => {
      fireEvent.pointerDown(dayBody, pointer(33, y(11 * 60)));
      fireEvent.pointerMove(dayBody, pointer(33, y(11 * 60 + 30)));
    });
    expect(document.querySelector("[data-calendar-create-ghost]")).not.toBeNull();
    await act(async () => {
      fireEvent.pointerCancel(dayBody, pointer(33, y(11 * 60 + 30)));
    });
    expect(document.querySelector("[data-calendar-create-ghost]")).toBeNull();
    await flushDocumentListeners();
    expect(screen.queryByTestId("calendar-compact-editor")).toBeNull();
  });

  it("accepts pen drags like mouse drags", async () => {
    renderCalendar();
    const dayBody = document.querySelector<HTMLElement>("[data-calendar-day-body]") as HTMLElement;
    pointTarget = dayBody;
    await act(async () => {
      fireEvent.pointerDown(dayBody, { ...pointer(35, y(9 * 60)), pointerType: "pen" });
      fireEvent.pointerMove(dayBody, { ...pointer(35, y(9 * 60 + 20)), pointerType: "pen" });
    });
    expect(document.querySelector("[data-calendar-create-ghost]")?.textContent).toMatch(/^09:00–09:20 · /);
  });

  it("never starts a drag from inside an existing block's semantic time (its visual gap included)", async () => {
    renderCalendar([entryAt(new Date(2026, 7, 2, 8, 0).toISOString(), new Date(2026, 7, 2, 9, 0).toISOString())]);
    const dayBody = document.querySelector<HTMLElement>("[data-calendar-day-body]") as HTMLElement;
    pointTarget = dayBody;
    await act(async () => {
      fireEvent.pointerDown(dayBody, pointer(36, y(8 * 60 + 59.5)));
      fireEvent.pointerMove(dayBody, pointer(36, y(10 * 60)));
    });
    expect(document.querySelector("[data-calendar-create-ghost]")).toBeNull();
    await act(async () => {
      fireEvent.pointerUp(dayBody, pointer(36, y(10 * 60)));
    });
    await flushDocumentListeners();
    expect(screen.queryByTestId("calendar-compact-editor")).toBeNull();
  });

  it("decides block occupancy at the press, so scrolling before the drag never changes it", async () => {
    renderCalendar([entryAt(new Date(2026, 7, 2, 8, 0).toISOString(), new Date(2026, 7, 2, 9, 0).toISOString())]);
    const dayBody = document.querySelector<HTMLElement>("[data-calendar-day-body]") as HTMLElement;
    pointTarget = dayBody;
    // Press in the block's gap, then the grid scrolls an hour before the pointer moves.
    await act(async () => {
      fireEvent.pointerDown(dayBody, pointer(37, y(8 * 60 + 59.5)));
    });
    dayBodyTop = -64;
    await act(async () => {
      fireEvent.pointerMove(dayBody, pointer(37, y(10 * 60)));
      fireEvent.pointerUp(dayBody, pointer(37, y(10 * 60)));
    });
    await flushDocumentListeners();
    expect(document.querySelector("[data-calendar-create-ghost]")).toBeNull();
    expect(screen.queryByTestId("calendar-compact-editor")).toBeNull();

    // A valid press on empty time stays valid even if the scroll would now put a block under it.
    dayBodyTop = 0;
    await act(async () => {
      fireEvent.pointerDown(dayBody, pointer(38, y(9 * 60 + 30)));
    });
    dayBodyTop = 64;
    await act(async () => {
      fireEvent.pointerMove(dayBody, pointer(38, y(9 * 60 + 50)));
    });
    expect(document.querySelector("[data-calendar-create-ghost]")?.textContent).toMatch(/^08:50–09:30 · /);
  });

  it("shows the real duration of an overnight block in the resize tip", async () => {
    const entry = entryAt(
      new Date(2026, 7, 1, 20, 0).toISOString(),
      new Date(2026, 7, 2, 7, 0).toISOString(),
      { id: "overnight" }
    );
    renderCalendar([entry]);
    const handle = document.querySelector<HTMLElement>(".swiss-resize-handle.bottom") as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(handle, pointer(43, y(7 * 60)));
      window.dispatchEvent(new PointerEvent("pointermove", pointer(43, y(7 * 60 + 25))));
    });
    expect(document.querySelector("[data-calendar-resize-tip]")?.textContent).toMatch(/^07:25 · 11h ?25/);
    // End the gesture so no window listener outlives this test.
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
  });

  it("cancels a resize when pointer capture is lost, without saving", async () => {
    const entry = entryAt(
      new Date(2026, 7, 2, 8, 0).toISOString(),
      new Date(2026, 7, 2, 9, 0).toISOString(),
      { id: "resize-lost" }
    );
    renderCalendar([entry]);
    const handle = document.querySelector<HTMLElement>(".swiss-resize-handle.bottom") as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(handle, pointer(44, y(9 * 60)));
      window.dispatchEvent(new PointerEvent("pointermove", pointer(44, y(9 * 60 + 30))));
    });
    expect(document.querySelector("[data-calendar-resize-tip]")).not.toBeNull();
    await act(async () => {
      handle.dispatchEvent(new PointerEvent("lostpointercapture", pointer(44, y(9 * 60 + 30))));
    });
    expect(document.querySelector("[data-calendar-resize-tip]")).toBeNull();
    await act(async () => {
      window.dispatchEvent(new PointerEvent("pointerup", pointer(44, y(9 * 60 + 30))));
    });
    await flushDocumentListeners();
    expect(fetchMock.clientFetch).not.toHaveBeenCalled();
  });

  it("ignores touch presses so the page keeps scrolling", async () => {
    renderCalendar();
    const dayBody = document.querySelector<HTMLElement>("[data-calendar-day-body]") as HTMLElement;
    pointTarget = dayBody;
    await act(async () => {
      fireEvent.pointerDown(dayBody, { ...pointer(34, y(9 * 60)), pointerType: "touch" });
      fireEvent.pointerMove(dayBody, { ...pointer(34, y(10 * 60)), pointerType: "touch" });
    });
    expect(document.querySelector("[data-calendar-create-ghost]")).toBeNull();
  });

  it("resizes an edge in 5-minute steps with a live time tip and saves through the update path", async () => {
    const entry = entryAt(
      new Date(2026, 7, 2, 8, 0).toISOString(),
      new Date(2026, 7, 2, 9, 0).toISOString(),
      { id: "resize-me" }
    );
    renderCalendar([entry]);
    const handle = document.querySelector<HTMLElement>(".swiss-resize-handle.bottom") as HTMLElement;
    expect(handle).not.toBeNull();
    await act(async () => {
      fireEvent.pointerDown(handle, pointer(41, y(9 * 60)));
      window.dispatchEvent(new PointerEvent("pointermove", pointer(41, y(9 * 60 + 12))));
    });
    expect(document.querySelector("[data-calendar-resize-tip]")?.textContent).toMatch(/^09:10 · /);
    await act(async () => {
      window.dispatchEvent(new PointerEvent("pointermove", pointer(41, y(9 * 60 + 23))));
    });
    expect(document.querySelector("[data-calendar-resize-tip]")?.textContent).toMatch(/^09:25 · /);
    await act(async () => {
      window.dispatchEvent(new PointerEvent("pointerup", pointer(41, y(9 * 60 + 23))));
    });
    expect(document.querySelector("[data-calendar-resize-tip]")).toBeNull();
    await waitFor(() => expect(fetchMock.clientFetch).toHaveBeenCalledOnce());
    const body = JSON.parse(fetchMock.clientFetch.mock.calls[0][1].body as string);
    expect(body.stoppedAt).toBe(new Date(2026, 7, 2, 9, 25).toISOString());
    expect(body.startedAt).toBe(entry.startedAt);
    // Times only: this tab's activity, place and description may be older than another device's edit,
    // and the PATCH applies every field it is sent (stability audit WEB-UI-1).
    expect(Object.keys(body).sort()).toEqual(["startedAt", "stoppedAt"]);
  });

  it("keeps a 5-minute minimum and Escape aborts a resize without saving", async () => {
    const entry = entryAt(
      new Date(2026, 7, 2, 8, 0).toISOString(),
      new Date(2026, 7, 2, 9, 0).toISOString(),
      { id: "resize-escape" }
    );
    renderCalendar([entry]);
    const handle = document.querySelector<HTMLElement>(".swiss-resize-handle.bottom") as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(handle, pointer(42, y(9 * 60)));
      window.dispatchEvent(new PointerEvent("pointermove", pointer(42, y(7 * 60))));
    });
    expect(document.querySelector("[data-calendar-resize-tip]")?.textContent).toMatch(/^08:05 · /);
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(document.querySelector("[data-calendar-resize-tip]")).toBeNull();
    await act(async () => {
      window.dispatchEvent(new PointerEvent("pointerup", pointer(42, y(7 * 60))));
    });
    await flushDocumentListeners();
    expect(fetchMock.clientFetch).not.toHaveBeenCalled();
  });
});

describe("Calendar create in future time (owner decision 12 Oct 2026, option B)", () => {
  // Today is Sunday 2 August 2026, 12:00 local; Monday 3 August is entirely in the future.
  const now = new Date(2026, 7, 2, 12, 0, 0, 0);
  const notice = "Blocks can't start in the future";

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    runtime.createManualEntry.mockReset().mockResolvedValue({ ok: true });
    anchorIsOffscreen = false;
    dayBodyTop = 0;
    pointTarget = null;
    installDomGeometry();
  });

  afterEach(() => {
    window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 0 }));
    cleanup();
    outsidePointerListeners.clear();
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const y = (minute: number) => (minute / 60) * 64;
  const pointer = (pointerId: number, clientY: number) => ({
    button: 0, clientX: 300, clientY, isPrimary: true, pointerId, pointerType: "mouse"
  });

  function weekProps(undoToastVisible: boolean, shownNow: Date = now): Parameters<typeof CalendarReview>[0] {
    return {
      calendarHoursMode: "fullDay",
      capturedNow: shownNow,
      categories: [],
      entries: [],
      onDeleteEntries: vi.fn(),
      onScroll: vi.fn(),
      onSynced: vi.fn().mockResolvedValue(undefined),
      places: [],
      scrollContainerRef: vi.fn(),
      tags: [],
      undoToastVisible,
      visibleDays: [new Date(2026, 7, 2, 12), new Date(2026, 7, 3, 12)]
    };
  }

  function renderWeek({ shownNow = now, undoToastVisible = false }: { shownNow?: Date; undoToastVisible?: boolean } = {}) {
    const { rerender } = render(createElement(CalendarReview, weekProps(undoToastVisible, shownNow)));
    const setUndoToastVisible = (visible: boolean) => rerender(createElement(CalendarReview, weekProps(visible)));
    const [today, tomorrow] = Array.from(document.querySelectorAll<HTMLElement>("[data-calendar-day-body]"));
    return { setUndoToastVisible, today, tomorrow };
  }

  function toast() {
    return document.querySelector<HTMLElement>(".df-toast");
  }

  it("marks future time for the not-allowed cursor without a render per move", () => {
    const { today, tomorrow } = renderWeek();
    expect(tomorrow.classList.contains("is-future")).toBe(true);
    expect(today.classList.contains("is-future")).toBe(false);
    const zone = today.querySelector<HTMLElement>("[data-calendar-future-zone]");
    // The zone starts exactly at the now line and runs to the end of the day.
    expect(zone?.style.top).toBe(`${y(12 * 60)}px`);
    expect(today.querySelector<HTMLElement>(".calendar-now-line")?.style.top).toBe(`${y(12 * 60)}px`);
    expect(tomorrow.querySelector("[data-calendar-future-zone]")).toBeNull();
  });

  it("draws no ghost for a drag that starts in the future, creates nothing and says why", async () => {
    const { today, tomorrow } = renderWeek();
    const zone = today.querySelector<HTMLElement>("[data-calendar-future-zone]") as HTMLElement;
    pointTarget = zone;
    await act(async () => {
      fireEvent.pointerDown(zone, pointer(51, y(13 * 60)));
      fireEvent.pointerMove(today, pointer(51, y(14 * 60)));
    });
    expect(document.querySelector("[data-calendar-create-ghost]")).toBeNull();
    expect(today.classList.contains("is-future-press")).toBe(true);
    // Dragging back up into the past still draws nothing: the press decided.
    await act(async () => {
      fireEvent.pointerMove(today, pointer(51, y(10 * 60)));
    });
    expect(document.querySelector("[data-calendar-create-ghost]")).toBeNull();
    expect(toast()).toBeNull();
    await act(async () => {
      fireEvent.pointerUp(today, pointer(51, y(10 * 60)));
    });
    await flushDocumentListeners();
    expect(today.classList.contains("is-future-press")).toBe(false);
    expect(screen.queryByTestId("calendar-compact-editor")).toBeNull();
    expect(runtime.createManualEntry).not.toHaveBeenCalled();
    const status = toast();
    expect(status?.textContent).toBe(notice);
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");

    // A drag on a later day does the same.
    pointTarget = tomorrow;
    await act(async () => {
      fireEvent.pointerDown(tomorrow, pointer(52, y(9 * 60)));
      fireEvent.pointerMove(tomorrow, pointer(52, y(10 * 60)));
    });
    expect(document.querySelector("[data-calendar-create-ghost]")).toBeNull();
    await act(async () => {
      fireEvent.pointerUp(tomorrow, pointer(52, y(10 * 60)));
    });
    await flushDocumentListeners();
    expect(screen.queryByTestId("calendar-compact-editor")).toBeNull();
    expect(toast()?.textContent).toBe(notice);

    // The notice leaves by itself shortly after.
    await waitFor(() => expect(toast()).toBeNull(), { timeout: 5_000 });
  }, 15_000);

  it("stops the ghost of a past-to-future drag at now and creates a block ending at now", async () => {
    const { today } = renderWeek();
    pointTarget = today;
    await act(async () => {
      fireEvent.pointerDown(today, pointer(53, y(11 * 60)));
      fireEvent.pointerMove(today, pointer(53, y(14 * 60 + 10)));
    });
    const ghost = document.querySelector<HTMLElement>("[data-calendar-create-ghost]");
    expect(ghost?.textContent).toMatch(/^11:00–12:00 · /);
    expect(Number.parseFloat(ghost?.style.top ?? "") + Number.parseFloat(ghost?.style.height ?? "") + 2)
      .toBe(y(12 * 60));
    await act(async () => {
      fireEvent.pointerUp(today, pointer(53, y(14 * 60 + 10)));
    });
    expect(document.querySelector("[data-calendar-create-ghost]")).toBeNull();
    await screen.findByTestId("calendar-compact-editor");
    expect(toast()).toBeNull();
    await flushDocumentListeners();
    await userEvent.click(screen.getByRole("button", { name: "Add block" }));
    await waitFor(() => expect(runtime.createManualEntry).toHaveBeenCalledOnce());
    expect(runtime.createManualEntry).toHaveBeenCalledWith(expect.objectContaining({
      startedAt: new Date(2026, 7, 2, 11, 0).toISOString(),
      stoppedAt: new Date(2026, 7, 2, 12, 0).toISOString()
    }));
  });

  it("keeps a ghost that ends at now above the now line, even at its 12px minimum (Codex r1 on #369)", async () => {
    const { today } = renderWeek();
    pointTarget = today;
    await act(async () => {
      fireEvent.pointerDown(today, pointer(61, y(11 * 60 + 55)));
      fireEvent.pointerMove(today, pointer(61, y(12 * 60 + 30)));
    });
    const ghost = document.querySelector<HTMLElement>("[data-calendar-create-ghost]");
    expect(ghost?.textContent).toMatch(/^11:55–12:00 · 5m/);
    const bottom = Number.parseFloat(ghost?.style.top ?? "") + Number.parseFloat(ghost?.style.height ?? "");
    expect(bottom).toBeLessThanOrEqual(y(12 * 60));
    expect(Number.parseFloat(ghost?.style.height ?? "")).toBe(12);
    await act(async () => {
      fireEvent.pointerUp(today, pointer(61, y(12 * 60 + 30)));
    });
    await screen.findByTestId("calendar-compact-editor");
    await flushDocumentListeners();
    await userEvent.click(screen.getByRole("button", { name: "Add block" }));
    await waitFor(() => expect(runtime.createManualEntry).toHaveBeenCalledOnce());
    expect(runtime.createManualEntry).toHaveBeenCalledWith(expect.objectContaining({
      startedAt: new Date(2026, 7, 2, 11, 55).toISOString(),
      stoppedAt: new Date(2026, 7, 2, 12, 0).toISOString()
    }));
  });

  it("keeps a short ghost ending just before now above the now line (Codex r2 on #369)", async () => {
    const shownNow = new Date(2026, 7, 2, 11, 56, 0, 0);
    vi.setSystemTime(shownNow);
    const { today } = renderWeek({ shownNow });
    pointTarget = today;
    await act(async () => {
      fireEvent.pointerDown(today, pointer(64, y(11 * 60 + 49)));
      fireEvent.pointerMove(today, pointer(64, y(11 * 60 + 55)));
    });
    const ghost = document.querySelector<HTMLElement>("[data-calendar-create-ghost]");
    expect(ghost?.textContent).toMatch(/^11:50–11:55 · 5m/);
    const bottom = Number.parseFloat(ghost?.style.top ?? "") + Number.parseFloat(ghost?.style.height ?? "");
    const line = Number.parseFloat(today.querySelector<HTMLElement>(".calendar-now-line")?.style.top ?? "");
    expect(line).toBe(Math.round(y(11 * 60 + 56)));
    expect(bottom).toBeLessThan(line);
    expect(Number.parseFloat(ghost?.style.height ?? "")).toBe(12);
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
  });

  it("decides against the now line it shows, not a fresher clock (Codex r1 on #369)", async () => {
    // The page last ticked at 12:00 (the line and the not-allowed zone are there); the clock says 12:20.
    vi.setSystemTime(new Date(2026, 7, 2, 12, 20, 0, 0));
    const { today } = renderWeek();
    expect(today.querySelector<HTMLElement>("[data-calendar-future-zone]")?.style.top).toBe(`${y(12 * 60)}px`);

    // A click below the shown line (where the cursor says not-allowed) opens nothing.
    const zone = today.querySelector<HTMLElement>("[data-calendar-future-zone]") as HTMLElement;
    pointTarget = zone;
    await act(async () => {
      fireEvent.pointerDown(zone, pointer(62, y(12 * 60 + 10)));
      fireEvent.pointerUp(zone, pointer(62, y(12 * 60 + 10)));
    });
    await flushDocumentListeners();
    expect(screen.queryByTestId("calendar-compact-editor")).toBeNull();
    expect(toast()?.textContent).toBe(notice);

    // A drag across it stops at the shown line and creates exactly that.
    pointTarget = today;
    await act(async () => {
      fireEvent.pointerDown(today, pointer(63, y(11 * 60)));
      fireEvent.pointerMove(today, pointer(63, y(12 * 60 + 15)));
    });
    expect(document.querySelector("[data-calendar-create-ghost]")?.textContent).toMatch(/^11:00–12:00 · 1h/);
    await act(async () => {
      fireEvent.pointerUp(today, pointer(63, y(12 * 60 + 15)));
    });
    await screen.findByTestId("calendar-compact-editor");
    await flushDocumentListeners();
    await userEvent.click(screen.getByRole("button", { name: "Add block" }));
    await waitFor(() => expect(runtime.createManualEntry).toHaveBeenCalledOnce());
    expect(runtime.createManualEntry).toHaveBeenCalledWith(expect.objectContaining({
      startedAt: new Date(2026, 7, 2, 11, 0).toISOString(),
      stoppedAt: new Date(2026, 7, 2, 12, 0).toISOString()
    }));
  });

  it("keeps an ordinary past drag working on today", async () => {
    const { today } = renderWeek();
    pointTarget = today;
    await act(async () => {
      fireEvent.pointerDown(today, pointer(54, y(9 * 60)));
      fireEvent.pointerMove(today, pointer(54, y(9 * 60 + 44)));
    });
    expect(document.querySelector("[data-calendar-create-ghost]")?.textContent).toMatch(/^09:00–09:45 · /);
    await act(async () => {
      fireEvent.pointerUp(today, pointer(54, y(9 * 60 + 44)));
    });
    await screen.findByTestId("calendar-compact-editor");
    await flushDocumentListeners();
    await userEvent.click(screen.getByRole("button", { name: "Add block" }));
    await waitFor(() => expect(runtime.createManualEntry).toHaveBeenCalledOnce());
    expect(runtime.createManualEntry).toHaveBeenCalledWith(expect.objectContaining({
      startedAt: new Date(2026, 7, 2, 9, 0).toISOString(),
      stoppedAt: new Date(2026, 7, 2, 9, 45).toISOString()
    }));
    expect(toast()).toBeNull();
  });

  it("shows the notice for a click in future time, and holds a click just before now at now", async () => {
    const { today } = renderWeek();
    const zone = today.querySelector<HTMLElement>("[data-calendar-future-zone]") as HTMLElement;
    pointTarget = zone;
    await act(async () => {
      fireEvent.pointerDown(zone, pointer(55, y(15 * 60)));
      fireEvent.pointerUp(zone, pointer(55, y(15 * 60)));
    });
    await flushDocumentListeners();
    expect(screen.queryByTestId("calendar-compact-editor")).toBeNull();
    expect(toast()?.textContent).toBe(notice);

    // 11:50 floors to 11:45; its 30-minute slot would end in the future, so it finishes at now.
    pointTarget = today;
    await act(async () => {
      fireEvent.pointerDown(today, pointer(56, y(11 * 60 + 50)));
      fireEvent.pointerUp(today, pointer(56, y(11 * 60 + 50)));
    });
    await screen.findByTestId("calendar-compact-editor");
    await flushDocumentListeners();
    await userEvent.click(screen.getByRole("button", { name: "Add block" }));
    await waitFor(() => expect(runtime.createManualEntry).toHaveBeenCalledOnce());
    expect(runtime.createManualEntry).toHaveBeenCalledWith(expect.objectContaining({
      startedAt: new Date(2026, 7, 2, 11, 45).toISOString(),
      stoppedAt: new Date(2026, 7, 2, 12, 0).toISOString()
    }));
  });

  it("cancels a future press quietly on Escape or pointer cancel", async () => {
    const { tomorrow } = renderWeek();
    pointTarget = tomorrow;
    await act(async () => {
      fireEvent.pointerDown(tomorrow, pointer(57, y(9 * 60)));
      fireEvent.pointerMove(tomorrow, pointer(57, y(10 * 60)));
    });
    expect(tomorrow.classList.contains("is-future-press")).toBe(true);
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(tomorrow.classList.contains("is-future-press")).toBe(false);
    await act(async () => {
      fireEvent.pointerUp(tomorrow, pointer(57, y(10 * 60)));
    });
    await act(async () => {
      fireEvent.pointerDown(tomorrow, pointer(58, y(9 * 60)));
      fireEvent.pointerCancel(tomorrow, pointer(58, y(9 * 60)));
      fireEvent.pointerUp(tomorrow, pointer(58, y(9 * 60)));
    });
    await flushDocumentListeners();
    expect(toast()).toBeNull();
    expect(screen.queryByTestId("calendar-compact-editor")).toBeNull();
  });

  it("only announces the notice while the Delete Undo toast holds the place", async () => {
    const { tomorrow } = renderWeek({ undoToastVisible: true });
    pointTarget = tomorrow;
    await act(async () => {
      fireEvent.pointerDown(tomorrow, pointer(59, y(9 * 60)));
      fireEvent.pointerUp(tomorrow, pointer(59, y(9 * 60)));
    });
    await flushDocumentListeners();
    expect(toast()).toBeNull();
    const announcer = document.querySelector<HTMLElement>("p.sr-only[role='status']");
    expect(announcer?.getAttribute("aria-live")).toBe("polite");
    expect(announcer?.textContent).toBe(notice);
  });

  it("gives the place to a delete's Undo toast and never pops the notice back afterwards", async () => {
    const { setUndoToastVisible, tomorrow } = renderWeek();
    pointTarget = tomorrow;
    await act(async () => {
      fireEvent.pointerDown(tomorrow, pointer(60, y(9 * 60)));
      fireEvent.pointerUp(tomorrow, pointer(60, y(9 * 60)));
    });
    expect(toast()?.textContent).toBe(notice);
    await act(async () => setUndoToastVisible(true));
    expect(toast()).toBeNull();
    await act(async () => setUndoToastVisible(false));
    expect(toast()).toBeNull();
    expect(document.querySelector<HTMLElement>("p.sr-only[role='status']")?.textContent).toBe("");
  });
});
