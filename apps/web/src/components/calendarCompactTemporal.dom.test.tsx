// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dateTimeLocalInputToIso } from "@/lib/format";
import type { CalendarEntryCompactSavePlan } from "@/lib/calendar-entry-compact-editor";
import type { TimeEntryRow } from "@/lib/queries";
import { CalendarEntryCompactEditor } from "./CalendarEntryCompactEditor";
import { OverlapNotice } from "./OverlapNotice";

describe("Calendar compact temporal DOM", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_200 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true, addListener: vi.fn(), removeListener: vi.fn() })
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    document.body.innerHTML = "";
  });

  it("synchronizes complete Start, Finish, and Duration values before blur", async () => {
    renderCompletedEditor();
    const start = await screen.findByLabelText("Start time") as HTMLInputElement;
    const finish = screen.getByLabelText("Finish time") as HTMLInputElement;
    const duration = screen.getByLabelText("Duration") as HTMLInputElement;

    fireEvent.change(start, { target: { value: "09:30" } });
    expect(duration.value).toBe("00:30");
    expect(finish.value).toBe("10:00");

    fireEvent.change(finish, { target: { value: "10:30" } });
    expect(duration.value).toBe("01:00");

    fireEvent.change(duration, { target: { value: "90m" } });
    expect(duration.value).toBe("01:30");
    expect(start.value).toBe("09:30");
    expect(finish.value).toBe("11:00");
    expect(duration.getAttribute("aria-label")).toBe("Duration in hours and minutes");
    expect(duration.getAttribute("placeholder")).toBe("00:30");
  });

  it("keeps incomplete time raw and delays its error until blur", async () => {
    renderCompletedEditor();
    const start = await screen.findByLabelText("Start time") as HTMLInputElement;
    const finish = screen.getByLabelText("Finish time") as HTMLInputElement;
    const duration = screen.getByLabelText("Duration") as HTMLInputElement;

    fireEvent.change(start, { target: { value: "11:" } });
    expect(start.value).toBe("11:");
    expect(finish.value).toBe("10:30");
    expect(duration.value).toBe("00:30");
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.blur(start);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("valid start date and time");
    expect(alert.id).not.toBe("");
    expect(start.getAttribute("aria-describedby")).toBe(alert.id);
    expect(finish.getAttribute("aria-describedby")).toBeNull();
    expect(duration.getAttribute("aria-describedby")).toBeNull();
    expect(document.getElementById(alert.id)).toBe(alert);
  });

  it("links Duration to its live validation error with a stable editor-scoped id", async () => {
    renderCompletedEditor();
    const duration = await screen.findByLabelText("Duration") as HTMLInputElement;
    const start = screen.getByLabelText("Start time");
    const finish = screen.getByLabelText("Finish time");

    fireEvent.change(duration, { target: { value: "" } });
    fireEvent.blur(duration);
    const alert = await screen.findByRole("alert");
    const errorId = alert.id;
    expect(alert.textContent).toMatch(/duration/i);
    expect(errorId).not.toBe("");
    expect(duration.getAttribute("aria-describedby")).toBe(errorId);
    expect(start.getAttribute("aria-describedby")).toBeNull();
    expect(finish.getAttribute("aria-describedby")).toBeNull();

    fireEvent.change(screen.getByLabelText("Time entry description"), { target: { value: "Still invalid" } });
    expect((await screen.findByRole("alert")).id).toBe(errorId);
  });

  it("keeps validation description ids unique across simultaneous editor instances", async () => {
    renderCompletedEditor();
    renderCompletedEditor();
    const finishes = screen.getAllByLabelText("Finish time") as HTMLInputElement[];

    fireEvent.change(finishes[0], { target: { value: "09:00" } });
    fireEvent.blur(finishes[0]);
    fireEvent.change(finishes[1], { target: { value: "08:30" } });
    fireEvent.blur(finishes[1]);

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(2);
    expect(new Set(alerts.map((alert) => alert.id)).size).toBe(2);
    expect(finishes[0].getAttribute("aria-describedby")).toBe(alerts[0].id);
    expect(finishes[1].getAttribute("aria-describedby")).toBe(alerts[1].id);
    expect(document.getElementById(alerts[0].id)).toBe(alerts[0]);
    expect(document.getElementById(alerts[1].id)).toBe(alerts[1]);
  });

  it("always renders both dates and supports keyboard selection in the shared picker", async () => {
    const user = userEvent.setup();
    renderCompletedEditor();
    const startDate = await screen.findByRole("button", { name: /Choose Start date, currently 2 August 2026/ });
    const finishDate = screen.getByRole("button", { name: /Choose Finish date, currently 2 August 2026/ });
    expect(startDate.textContent).toBe("");
    expect(finishDate.textContent).toBe("");

    finishDate.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Choose Finish date" })).not.toBeNull();
    const nextDay = screen.getByRole("button", { name: /Monday, 3 August 2026/i });
    nextDay.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(finishDate.getAttribute("aria-label")).toContain("3 August 2026"));
    expect(screen.getByText("+1").getAttribute("title")).toBe("Finish time, one day after Start");
    expect((screen.getByLabelText("Duration") as HTMLInputElement).value).toBe("24:30");
    expect(document.activeElement).toBe(finishDate);
  });

  it("retains invalid Finish, gives validation priority, then gives discard priority", async () => {
    const user = userEvent.setup();
    renderCompletedEditor([entry("2026-08-02T09:45", "2026-08-02T10:15", "peer-1")]);
    const editor = await screen.findByTestId("calendar-compact-editor");
    const feedback = editor.querySelector(".calendar-compact-editor-footer") as HTMLElement;
    expect(feedback.getAttribute("data-feedback-mode")).toBe("overlap");
    expect(screen.getByText("Overlaps one entry by 00:15")).not.toBeNull();

    const finish = screen.getByLabelText("Finish time") as HTMLInputElement;
    fireEvent.change(finish, { target: { value: "09:00" } });
    fireEvent.blur(finish);
    expect(finish.value).toBe("09:00");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Finish must be after Start");
    expect(screen.getByLabelText("Start time").getAttribute("aria-invalid")).toBeNull();
    expect(finish.getAttribute("aria-invalid")).toBe("true");
    expect(finish.getAttribute("aria-describedby")).toBe(alert.id);
    expect(document.getElementById(alert.id)).toBe(alert);
    expect(feedback.getAttribute("data-feedback-mode")).toBe("error");

    await user.click(screen.getByRole("button", { name: "Close editor" }));
    expect(await screen.findByRole("alertdialog", { name: "Discard changes?" })).not.toBeNull();
    expect(feedback.getAttribute("data-feedback-mode")).toBe("discard");
    expect(finish.getAttribute("aria-describedby")).toBeNull();
    expect(document.getElementById(alert.id)).toBeNull();
    expect(screen.getByRole("button", { name: "Go back" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Discard" })).not.toBeNull();
  });

  it("renders one line of compact overlap copy without iconography, peer names or ranges", () => {
    const peers = [
      entry("2026-08-02T10:00", "2026-08-02T10:15", "peer-1", "Private name one"),
      entry("2026-08-02T10:15", "2026-08-02T10:30", "peer-2", "Private name two")
    ];
    render(createElement(OverlapNotice, {
      candidate: { startedAt: localIso("2026-08-02T10:00"), stoppedAt: localIso("2026-08-02T10:30") },
      compact: true,
      entries: peers
    }));

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Overlaps 2 entries by 00:30");
    expect(notice.querySelector("svg")).toBeNull();
    expect(screen.queryByText(/Private name/)).toBeNull();
    expect(screen.queryByText(/This is allowed/)).toBeNull();
  });

  it("allows a completed entry to finish in the future without error styling", async () => {
    renderEditor({
      capturedNow: new Date(2026, 7, 2, 10),
      sourceEntry: entry("2026-08-02T09:00", "2026-08-02T09:30")
    });
    const finish = await screen.findByLabelText("Finish time") as HTMLInputElement;

    fireEvent.change(finish, { target: { value: "11:00" } });
    fireEvent.blur(finish);

    expect(finish.value).toBe("11:00");
    expect(finish.getAttribute("aria-invalid")).toBeNull();
    expect(finish.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByLabelText("Duration") as HTMLInputElement).value).toBe("02:00");
  });

  it("keeps running Finish static, Duration read-only and live, and Start save-only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 2, 10, 30, 0));
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    const view = renderEditor({
      capturedNow: new Date(2026, 7, 2, 10, 30, 0),
      sourceEntry: entry("2026-08-02T10:00", null),
      onSave
    });

    await act(async () => vi.advanceTimersByTime(0));
    expect(screen.getByText("Running")).not.toBeNull();
    expect(screen.queryByLabelText("Finish time")).toBeNull();
    expect(screen.queryByRole("button", { name: /Choose Finish date/ })).toBeNull();
    expect(screen.queryByLabelText("Duration")).toBeNull();
    expect(screen.getByLabelText("Elapsed time").textContent).toContain("00:30");

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByLabelText("Elapsed time").textContent).toContain("00:30");

    const start = screen.getByLabelText("Start time");
    fireEvent.change(start, { target: { value: "09:45" } });
    fireEvent.blur(start);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await act(async () => Promise.resolve());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].payload).toEqual({ startedAt: localIso("2026-08-02T09:45") });

    view.rerenderEntry(entry("2026-08-02T10:00", "2026-08-02T10:30"));
    await act(async () => Promise.resolve());
    expect(screen.getByRole("button", { name: /Choose Finish date/ })).not.toBeNull();
    expect(screen.getByLabelText("Finish time")).not.toBeNull();
    expect(screen.getByLabelText("Duration")).not.toBeNull();
  });
});

function renderCompletedEditor(peers: TimeEntryRow[] = []) {
  return renderEditor({ peers, sourceEntry: entry("2026-08-02T10:00", "2026-08-02T10:30") });
}

function renderEditor({
  capturedNow = new Date(2026, 7, 2, 12),
  onSave = vi.fn().mockResolvedValue({ ok: true }),
  peers = [],
  sourceEntry
}: {
  capturedNow?: Date;
  onSave?: (plan: CalendarEntryCompactSavePlan) => Promise<{ ok: true } | { ok: false; error: string }>;
  peers?: TimeEntryRow[];
  sourceEntry: TimeEntryRow;
}) {
  const anchor = document.createElement("article");
  anchor.getBoundingClientRect = () => ({
    bottom: 160, height: 60, left: 100, right: 220, top: 100, width: 120, x: 100, y: 100, toJSON: () => ({})
  });
  document.body.append(anchor);
  const props = {
    anchor,
    capturedNow,
    categories: [],
    entry: sourceEntry,
    focusOnOpen: false,
    isTimerBusy: false,
    mode: "entry" as const,
    onDelete: vi.fn(),
    onDismiss: vi.fn(),
    onSave,
    onStartAgain: vi.fn().mockResolvedValue({ ok: true }),
    peerEntries: peers,
    positionKey: "temporal-dom",
    scrollContainer: null
  };
  const view = render(createElement(CalendarEntryCompactEditor, props));
  return {
    ...view,
    rerenderEntry(nextEntry: TimeEntryRow) {
      view.rerender(createElement(CalendarEntryCompactEditor, { ...props, entry: nextEntry }));
    }
  };
}

function entry(
  startedAt: string,
  stoppedAt: string | null,
  id = "entry-1",
  description = "Deep work"
): TimeEntryRow {
  const start = localIso(startedAt);
  const stop = stoppedAt ? localIso(stoppedAt) : null;
  return {
    id,
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
    description,
    startedAt: start,
    stoppedAt: stop,
    updatedAt: start,
    durationSeconds: stop ? Math.floor((new Date(stop).getTime() - new Date(start).getTime()) / 1_000) : 1_800,
    tagNames: [],
    tags: []
  };
}

function localIso(value: string) {
  const iso = dateTimeLocalInputToIso(value);
  if (!iso) throw new Error(`Bad test date: ${value}`);
  return iso;
}
