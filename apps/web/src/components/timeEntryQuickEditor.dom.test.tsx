// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEntryCompactSavePlan } from "@/lib/calendar-entry-compact-editor";
import type { TimeEntryRow } from "@/lib/queries";
import { TimeEntryQuickEditorModal } from "./TimeEntryQuickEditor";

type SaveHandler = (plan: CalendarEntryCompactSavePlan) => Promise<{ ok: true } | { ok: false; error: string }>;

describe("TimeEntryQuickEditorModal", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true, addListener: vi.fn(), removeListener: vi.fn() })
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_200 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("hydrates, removes and selects tags and saves one Place-safe partial payload", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn<SaveHandler>().mockResolvedValue({ ok: true });
    renderModal({ onClose, onSave });

    expect(await screen.findByTestId("time-entry-quick-editor-modal")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Remove tag Planning" })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Choose Start date/ }).textContent).toBe("");
    expect(screen.getByRole("button", { name: /Choose Finish date/ }).textContent).toBe("");

    await userEvent.click(screen.getByRole("button", { name: "Remove tag Planning" }));
    await userEvent.click(screen.getByRole("button", { name: "Add or filter tags" }));
    const picker = await screen.findByRole("dialog", { name: "Add or filter tags" });
    await userEvent.click(picker.querySelectorAll("button")[2]);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const plan = onSave.mock.calls[0][0];
    expect(plan.payload).toEqual({ tagNames: ["Deep work"] });
    expect(plan.payload).not.toHaveProperty("placeId");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes nested tag and date panels before dismissing the modal", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    const tagTrigger = await screen.findByRole("button", { name: "Add or filter tags" });
    await userEvent.click(tagTrigger);
    expect(await screen.findByRole("dialog", { name: "Add or filter tags" })).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(tagTrigger.getAttribute("aria-expanded")).toBe("false"));
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(tagTrigger));

    const dateTrigger = screen.getByRole("button", { name: /Choose Start date/ });
    await userEvent.click(dateTrigger);
    expect(await screen.findByRole("dialog", { name: "Choose Start date" })).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(dateTrigger.getAttribute("aria-expanded")).toBe("false"));
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(dateTrigger);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("routes dirty Cancel and backdrop dismissal through the same discard plane", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    const description = await screen.findByLabelText("Time entry description");
    await userEvent.type(description, " updated");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("alertdialog", { name: "Discard changes?" })).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));

    fireEvent.mouseDown(screen.getByTestId("time-entry-quick-editor-modal"));
    expect(await screen.findByRole("alertdialog", { name: "Discard changes?" })).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

function renderModal({
  onClose = vi.fn(),
  onSave = vi.fn<SaveHandler>().mockResolvedValue({ ok: true })
}: {
  onClose?: () => void;
  onSave?: SaveHandler;
} = {}) {
  return render(createElement(TimeEntryQuickEditorModal, {
    capturedNow: new Date("2026-08-04T12:00:00.000Z"),
    categories: [],
    entry: timeEntry(),
    isTimerBusy: false,
    onClose,
    onSave,
    peerEntries: [],
    tags: [
      { id: "planning", name: "Planning", normalizedName: "planning", usageCount: 2 },
      { id: "deep-work", name: "Deep work", normalizedName: "deep work", usageCount: 1 }
    ]
  }));
}

function timeEntry(): TimeEntryRow {
  return {
    id: "entry-1",
    projectId: "legacy-project",
    projectName: "Legacy project",
    projectColor: null,
    clientName: "Legacy client",
    categoryId: null,
    categoryName: null,
    categoryColor: null,
    placeId: "office",
    placeName: "Office",
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: "Plan release",
    startedAt: "2026-08-04T09:00:00.000Z",
    stoppedAt: "2026-08-04T10:00:00.000Z",
    updatedAt: "2026-08-04T10:00:00.000Z",
    durationSeconds: 3_600,
    tagNames: ["Planning"],
    tags: [{ id: "planning", name: "Planning", normalizedName: "planning" }]
  };
}
