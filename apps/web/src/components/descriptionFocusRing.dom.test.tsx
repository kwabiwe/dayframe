// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

// Trello 213 (Codex r1, r2): the command timer's Description shows its neutral perimeter for keyboard,
// shortcut, programmatic and assistive-technology focus only — never after a click or tap.
let runtime: Record<string, unknown>;

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => runtime
}));

const { PersistentTimerBar } = await import("./PersistentTimerBar");

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

// The pointer modality lasts through the gesture's focus hand-off: two frames and a task after
// pointerup. Waiting this long lets it expire.
const afterPointerGesture = () => act(() => new Promise((resolve) => setTimeout(resolve, 80)));

describe.each([
  ["idle", null],
  ["running", runningEntry()]
] as const)("command timer Description focus ring (%s)", (_state, activeEntry) => {
  function setup() {
    runtime = runtimeFixture(activeEntry);
    render(<PersistentTimerBar />);
    const description = screen.getByLabelText("Description") as HTMLInputElement;
    const field = description.closest(".swiss-timer-description-control");
    if (!(field instanceof HTMLElement)) throw new Error("Missing Description wrapper");
    return { description, field };
  }

  it("a click focuses the field without the keyboard ring, and typing keeps it off", async () => {
    const user = userEvent.setup();
    const { description, field } = setup();

    await user.click(description);
    expect(document.activeElement).toBe(description);
    expect(field.dataset.focusRing).toBeUndefined();

    await user.type(description, "Plan");
    expect(field.dataset.focusRing).toBeUndefined();
  });

  it("a touch tap focuses the field without the keyboard ring", async () => {
    const { description, field } = setup();

    fireEvent.pointerDown(description, { pointerType: "touch" });
    act(() => description.focus());
    fireEvent.pointerUp(description, { pointerType: "touch" });
    expect(field.dataset.focusRing).toBeUndefined();

    // Once the tap is over, focus that arrives without a pointer shows the ring again.
    await afterPointerGesture();
    act(() => description.blur());
    act(() => description.focus());
    expect(field.dataset.focusRing).toBe("keyboard");
  });

  it("Tab focus shows the keyboard ring; a later click hides it; leaving clears it", async () => {
    const user = userEvent.setup();
    const { description, field } = setup();

    for (let step = 0; step < 12 && document.activeElement !== description; step += 1) {
      await user.tab();
    }
    expect(document.activeElement).toBe(description);
    expect(field.dataset.focusRing).toBe("keyboard");

    await user.click(description);
    expect(field.dataset.focusRing).toBeUndefined();

    await user.tab();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(description);
    expect(field.dataset.focusRing).toBe("keyboard");

    act(() => description.blur());
    expect(field.dataset.focusRing).toBeUndefined();
  });

  it("focus moved by a shortcut, script or assistive technology shows the keyboard ring", () => {
    const { description, field } = setup();

    // The N shortcut: a keydown, then the shell focuses the field.
    fireEvent.keyDown(document, { key: "n" });
    act(() => description.focus());
    expect(field.dataset.focusRing).toBe("keyboard");

    act(() => description.blur());
    // Assistive technology or script focus with no pointer press at all.
    act(() => description.focus());
    expect(field.dataset.focusRing).toBe("keyboard");
  });

  it("a click on the wrapper's gutter, which focuses nothing, leaves no stale pointer mark (Codex r2)", async () => {
    const user = userEvent.setup();
    const { description, field } = setup();

    await user.click(field);
    expect(document.activeElement).not.toBe(description);
    await afterPointerGesture();

    // A later script or assistive-technology focus still shows the ring.
    act(() => description.focus());
    expect(field.dataset.focusRing).toBe("keyboard");
  });

  it("WebKit's Tags click (blur to body, then the picker's scheduled search focus) stays pointer focus (Codex r2)", async () => {
    const user = userEvent.setup();
    const { description, field } = setup();
    await user.click(description);
    const trigger = screen.getByRole("button", { name: "Add or filter tags" });

    // WebKit does not focus a clicked button: the Description blurs to body first.
    fireEvent.pointerDown(trigger, { pointerType: "mouse" });
    act(() => description.blur());
    expect(document.activeElement).toBe(document.body);
    fireEvent.pointerUp(trigger, { pointerType: "mouse" });
    fireEvent.click(trigger);
    // The picker focuses its search in a later frame, inside the same gesture's hand-off.
    const search = pickerSearch(field);
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(field.dataset.focusRing).toBeUndefined();
  });

  it("opening Tags with the mouse never brings the keyboard ring back", async () => {
    const user = userEvent.setup();
    const { description, field } = setup();
    await user.click(description);

    await user.click(screen.getByRole("button", { name: "Add or filter tags" }));
    const search = pickerSearch(field);
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(field.dataset.focusRing).toBeUndefined();
  });
});

function pickerSearch(field: HTMLElement) {
  const search = field.querySelector<HTMLInputElement>(".inline-tag-picker-search input");
  if (!search) throw new Error("Missing tag picker search");
  return search;
}

function runtimeFixture(activeEntry: TimeEntryRow | null) {
  const data = {
    activeEntry,
    categories: [{ id: "focus", name: "Focus", color: "mint", isPinned: false }],
    categoryUsage: [],
    dateRange: { selectedDate: "2026-08-14" },
    entries: activeEntry ? [activeEntry] : [],
    tags: [],
    taskSuggestions: []
  } as unknown as BootstrapData;
  return {
    clearTimerError: vi.fn(),
    closeManualEntry: vi.fn(),
    createCategory: vi.fn().mockResolvedValue({ ok: true }),
    createManualEntry: vi.fn().mockResolvedValue({ ok: true }),
    deleteActiveTimer: vi.fn().mockResolvedValue({ ok: true }),
    isManualEntryOpen: false,
    isTimerBusy: false,
    openManualEntry: vi.fn(),
    setTimerDraft: vi.fn(),
    shellData: data,
    startTimer: vi.fn().mockResolvedValue({ ok: true }),
    stopTimer: vi.fn().mockResolvedValue({ ok: true }),
    timerDraft: { categoryId: "", description: "", tagNames: [] },
    timerError: null,
    updateActiveDetails: vi.fn().mockResolvedValue({ ok: true }),
    updateActiveStartTime: vi.fn().mockResolvedValue({ ok: true })
  };
}

function runningEntry(): TimeEntryRow {
  return {
    id: "running-entry",
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: "focus",
    categoryName: "Focus",
    categoryColor: "mint",
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: "Deep planning",
    startedAt: "2026-08-14T09:00:00.000Z",
    stoppedAt: null,
    updatedAt: "2026-08-14T09:00:00.000Z",
    durationSeconds: 3_600,
    tagNames: [],
    tags: []
  } as TimeEntryRow;
}
