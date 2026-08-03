// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
let pointTarget: Element | null = null;
const capturedPointers = new WeakMap<Element, Set<number>>();

describe("Calendar click-to-create DOM interactions", () => {
  beforeEach(() => {
    runtime.clearTimerError.mockReset();
    runtime.createManualEntry.mockReset().mockResolvedValue({ ok: true });
    runtime.startEntryAgain.mockReset().mockResolvedValue({ ok: true });
    runtime.updateActiveEntryFromCalendar.mockReset().mockResolvedValue({ ok: true });
    runtime.isTimerBusy = false;
    anchorIsOffscreen = false;
    pointTarget = null;
    installDomGeometry();
  });

  afterEach(() => {
    cleanup();
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

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(editor.getAttribute("aria-busy")).toBe("true"));

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
  });

  it("routes dirty scroll-away through one discard decision and restores the edited field focus", async () => {
    renderCalendar();
    await openCreateAt(9 * 60);
    const description = screen.getByLabelText("Description") as HTMLInputElement;
    await userEvent.type(description, "Keep this draft");
    anchorIsOffscreen = true;

    fireEvent.scroll(screen.getByLabelText("Calendar time grid"));
    const prompt = await screen.findByRole("alertdialog");
    expect(prompt.textContent).toContain("Discard changes?");
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
    const category = screen.getByRole("button", { name: /Uncategorized/ });
    await waitFor(() => expect(document.activeElement).toBe(description));

    await userEvent.tab();
    expect(document.activeElement).toBe(category);
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

  it("keeps the consumed pointer through React pointerup so the first blank click only dismisses", async () => {
    renderCalendar();
    const dayBody = await openCreateAt(8 * 60);
    await flushDocumentListeners();

    await clickDay(dayBody, 9 * 60, 31);
    await waitFor(() => expect(screen.queryByTestId("calendar-compact-editor")).toBeNull());

    await clickDay(dayBody, 9 * 60, 32);
    expect(await screen.findByTestId("calendar-compact-editor")).not.toBeNull();
    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("09:00");
  });

  it("repositions with a same-duration moved anchor and keeps a real overlapping entry above it", async () => {
    renderCalendar([entryAt("2026-08-02T11:00:00.000Z", "2026-08-02T11:30:00.000Z")]);
    await openCreateAt(10 * 60);
    const editor = screen.getByTestId("calendar-compact-editor");
    const initialEditorTop = Number.parseFloat(editor.style.top);
    const anchor = document.querySelector<HTMLElement>("[data-calendar-draft]") as HTMLElement;
    const initialHeight = Number.parseFloat(anchor.style.height);

    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "11:00" } });
    fireEvent.change(screen.getByLabelText("Finish time"), { target: { value: "11:30" } });
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
});

function renderCalendar(entries: TimeEntryRow[] = []) {
  return render(createElement(CalendarReview, {
    calendarHoursMode: "fullDay",
    capturedNow: new Date("2026-08-02T12:00:00.000Z"),
    categories: [],
    entries,
    onDeleteEntries: vi.fn(),
    onScroll: vi.fn(),
    onSynced: vi.fn().mockResolvedValue(undefined),
    places: [],
    scrollContainerRef: vi.fn(),
    tags: [],
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

async function flushDocumentListeners() {
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 1)));
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
    if (this.matches("[data-calendar-day-body]")) return domRect(104, 0, 800, 1_536);
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

function entryAt(startedAt: string, stoppedAt: string): TimeEntryRow {
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
    durationSeconds: 1_800,
    tagNames: [],
    tags: []
  };
}
