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

  it("synchronizes Start, Finish, and Duration from the actively blurred field", async () => {
    renderCompletedEditor();
    const start = await screen.findByLabelText("Start time") as HTMLInputElement;
    const finish = screen.getByLabelText("Finish time") as HTMLInputElement;
    const duration = screen.getByLabelText("Duration") as HTMLInputElement;

    fireEvent.change(start, { target: { value: "09:30" } });
    fireEvent.blur(start);
    expect(duration.value).toBe("00:30:00");
    expect(finish.value).toBe("10:00");

    fireEvent.change(finish, { target: { value: "10:30" } });
    fireEvent.blur(finish);
    expect(duration.value).toBe("01:00:00");

    fireEvent.change(duration, { target: { value: "1:30:00" } });
    fireEvent.blur(duration);
    expect(duration.value).toBe("01:30:00");
    expect(start.value).toBe("09:30");
    expect(finish.value).toBe("11:00");
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
    expect((screen.getByLabelText("Duration") as HTMLInputElement).value).toBe("24:30:00");
    expect(document.activeElement).toBe(finishDate);
  });

  it("retains invalid Finish, gives validation priority, then gives discard priority", async () => {
    const user = userEvent.setup();
    renderCompletedEditor([entry("2026-08-02T09:45", "2026-08-02T10:15", "peer-1")]);
    const editor = await screen.findByTestId("calendar-compact-editor");
    const feedback = editor.querySelector(".calendar-compact-editor-footer") as HTMLElement;
    expect(feedback.getAttribute("data-feedback-mode")).toBe("overlap");
    expect(screen.getByText("Overlaps with 1 entry by 00:15")).not.toBeNull();

    const finish = screen.getByLabelText("Finish time") as HTMLInputElement;
    fireEvent.change(finish, { target: { value: "09:00" } });
    fireEvent.blur(finish);
    expect(finish.value).toBe("09:00");
    expect((await screen.findByRole("alert")).textContent).toContain("Finish must be after Start");
    expect(screen.getByLabelText("Start time").getAttribute("aria-invalid")).toBeNull();
    expect(finish.getAttribute("aria-invalid")).toBe("true");
    expect(feedback.getAttribute("data-feedback-mode")).toBe("error");

    await user.click(screen.getByRole("button", { name: "Close editor" }));
    expect(await screen.findByRole("alertdialog", { name: "Discard changes?" })).not.toBeNull();
    expect(feedback.getAttribute("data-feedback-mode")).toBe("discard");
    expect(screen.getByRole("button", { name: "Go back" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Discard" })).not.toBeNull();
  });

  it("renders exact compact overlap pluralization without peer names or ranges", () => {
    const peers = [
      entry("2026-08-02T10:00", "2026-08-02T10:15", "peer-1", "Private name one"),
      entry("2026-08-02T10:15", "2026-08-02T10:30", "peer-2", "Private name two")
    ];
    render(createElement(OverlapNotice, {
      candidate: { startedAt: localIso("2026-08-02T10:00"), stoppedAt: localIso("2026-08-02T10:30") },
      compact: true,
      entries: peers
    }));

    expect(screen.getByRole("status").textContent).toContain("Overlaps with 2 entries by 00:30");
    expect(screen.queryByText(/Private name/)).toBeNull();
    expect(screen.queryByText(/This is allowed/)).toBeNull();
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
    expect(screen.getByLabelText("Elapsed time").textContent).toContain("00:30:00");

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByLabelText("Elapsed time").textContent).toContain("00:30:01");

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
