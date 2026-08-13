// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEntryCompactSavePlan } from "@/lib/calendar-entry-compact-editor";
import { dateTimeLocalInputToIso } from "@/lib/format";
import type { TimeEntryRow } from "@/lib/queries";
import { TimeEntryQuickEditorModal } from "./TimeEntryQuickEditor";

type SaveHandler = (plan: CalendarEntryCompactSavePlan) => Promise<{ ok: true } | { ok: false; error: string }>;
type DeleteHandler = () => Promise<{ ok: true } | { ok: false; error: string }>;

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

  it("uses one Edit Entry title without repeating completed or running descriptions", async () => {
    const completed = renderModal({ sourceEntry: timeEntry({ description: "Sleep" }) });
    const completedEditor = await screen.findByTestId("time-entry-quick-editor");
    expect(completedEditor.querySelector(".calendar-compact-editor-header")?.textContent).toBe("Edit Entry");
    expect((screen.getByLabelText("Time entry description") as HTMLInputElement).value).toBe("Sleep");

    completed.unmount();
    renderModal({ sourceEntry: timeEntry({ description: null, stoppedAt: null }) });
    const runningEditor = await screen.findByTestId("time-entry-quick-editor");
    expect(runningEditor.querySelector(".calendar-compact-editor-header")?.textContent).toBe("Edit Entry");
    expect(runningEditor.querySelector(".calendar-compact-editor-header")?.textContent).not.toContain("Untitled entry");
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

  it("saves the complete valid draft once from plain Enter in Description and exits", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn<SaveHandler>().mockResolvedValue({ ok: true });
    renderModal({ onClose, onSave });
    const start = await screen.findByLabelText("Start time");
    const description = screen.getByLabelText("Time entry description");

    fireEvent.change(start, { target: { value: "08:30" } });
    fireEvent.change(description, { target: { value: "Plan release follow-up" } });
    fireEvent.keyDown(description, { key: "Enter" });

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].payload).toEqual({
      description: "Plan release follow-up",
      startedAt: localIso("2026-08-04T08:30"),
      stoppedAt: localIso("2026-08-04T09:30")
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("accepts four compact digits without losing the fourth digit to controlled-input masking", async () => {
    const onSave = vi.fn<SaveHandler>().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderModal({ onSave });
    const finish = await screen.findByLabelText("Finish time") as HTMLInputElement;

    await user.clear(finish);
    await user.type(finish, "1025");

    expect(finish.value).toBe("10:25");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].payload).toEqual({ stoppedAt: localIso("2026-08-04T10:25") });
  });

  it("normalises three compact digits on blur before Save", async () => {
    const onSave = vi.fn<SaveHandler>().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderModal({ onSave });
    const start = await screen.findByLabelText("Start time") as HTMLInputElement;

    await user.clear(start);
    await user.type(start, "725");
    expect(start.value).toBe("725");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].payload).toEqual({
      startedAt: localIso("2026-08-04T07:25"),
      stoppedAt: localIso("2026-08-04T08:25")
    });
  });

  it("closes a no-change existing entry from Enter without PATCH", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn<SaveHandler>().mockResolvedValue({ ok: true });
    renderModal({ onClose, onSave });
    const description = await screen.findByLabelText("Time entry description");

    fireEvent.keyDown(description, { key: "Enter" });

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the draft open after Enter save failure", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn<SaveHandler>().mockResolvedValue({ ok: false, error: "Server rejected the update." });
    renderModal({ onClose, onSave });
    const description = await screen.findByLabelText("Time entry description") as HTMLInputElement;
    fireEvent.change(description, { target: { value: "Keep this draft" } });
    fireEvent.keyDown(description, { key: "Enter" });

    expect((await screen.findByRole("alert")).textContent).toContain("Server rejected the update");
    expect(description.value).toBe("Keep this draft");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("gives hashtag selection, modifiers, and IME composition precedence over Enter save", async () => {
    const onSave = vi.fn<SaveHandler>().mockResolvedValue({ ok: true });
    renderModal({ onSave });
    const description = await screen.findByLabelText("Time entry description");

    for (const modifier of ["shiftKey", "ctrlKey", "altKey", "metaKey"] as const) {
      fireEvent.keyDown(description, { key: "Enter", [modifier]: true });
    }
    fireEvent.keyDown(description, { key: "Enter", isComposing: true });
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(description, { target: { value: "#Pla", selectionStart: 4 } });
    fireEvent.keyUp(description, { key: "a" });
    await screen.findByRole("listbox");
    fireEvent.keyDown(description, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Remove tag Planning" })).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("mutation-gates rapid Description Enter presses", async () => {
    let resolveSave!: (value: { ok: true }) => void;
    const onSave = vi.fn<SaveHandler>().mockImplementation(() => new Promise((resolve) => {
      resolveSave = resolve;
    }));
    renderModal({ onSave });
    const description = await screen.findByLabelText("Time entry description");
    fireEvent.change(description, { target: { value: "Changed" } });
    fireEvent.keyDown(description, { key: "Enter" });
    fireEvent.keyDown(description, { key: "Enter" });
    expect(onSave).toHaveBeenCalledOnce();
    resolveSave({ ok: true });
  });

  it("disables Description, tags, and every conflicting control for the full Save request", async () => {
    const deferred = promiseController<{ ok: false; error: string }>();
    const onClose = vi.fn();
    const onSave = vi.fn<SaveHandler>().mockReturnValue(deferred.promise);
    const onDelete = vi.fn<DeleteHandler>().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderModal({ onClose, onDelete, onSave });
    const editor = await screen.findByTestId("time-entry-quick-editor");
    const description = screen.getByLabelText("Time entry description") as HTMLInputElement;

    await user.clear(description);
    await user.type(description, "Captured before save{Enter}");
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

    expect(editor.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Saving entry…");
    expect(description.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Remove tag Planning" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add or filter tags" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Uncategorized/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Start time") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Finish time") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Duration in hours and minutes") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Delete Plan release/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Close editor" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);

    await user.type(description, " late edit");
    await user.click(screen.getByRole("button", { name: "Remove tag Planning" }));
    expect(description.value).toBe("Captured before save");
    expect(screen.getByRole("button", { name: "Remove tag Planning" })).not.toBeNull();

    await act(async () => deferred.resolve({ ok: false, error: "Save failed safely." }));
    expect((await screen.findByRole("alert")).textContent).toContain("Save failed safely");
    await waitFor(() => expect(description.disabled).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(description));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("enters a duplicate-safe Delete busy state and restores the editor after failure", async () => {
    const deferred = promiseController<{ ok: false; error: string }>();
    const onClose = vi.fn();
    const onDelete = vi.fn<DeleteHandler>().mockReturnValue(deferred.promise);
    const user = userEvent.setup();
    renderModal({ onClose, onDelete });
    const editor = await screen.findByTestId("time-entry-quick-editor");
    const deleteButton = screen.getByRole("button", { name: "Delete Plan release" }) as HTMLButtonElement;

    await user.click(deleteButton);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(editor.getAttribute("aria-busy")).toBe("true");
    expect(deleteButton.getAttribute("aria-busy")).toBe("true");
    expect(deleteButton.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Deleting entry…");
    expect((screen.getByLabelText("Time entry description") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledOnce();

    await act(async () => deferred.resolve({ ok: false, error: "Delete was rejected." }));
    expect((await screen.findByRole("alert")).textContent).toContain("Delete was rejected");
    await waitFor(() => expect(editor.getAttribute("aria-busy")).toBeNull());
    expect(deleteButton.disabled).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(deleteButton));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dismisses only after a successful asynchronous Delete settles", async () => {
    const deferred = promiseController<{ ok: true }>();
    const onClose = vi.fn();
    const onDelete = vi.fn<DeleteHandler>().mockReturnValue(deferred.promise);
    renderModal({ onClose, onDelete });

    await userEvent.click(await screen.findByRole("button", { name: "Delete Plan release" }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => deferred.resolve({ ok: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("dismisses an untouched running editor cleanly but prompts after a real Start edit", async () => {
    const onClose = vi.fn();
    const view = renderModal({ onClose, sourceEntry: timeEntry({ stoppedAt: null, durationSeconds: 3_600 }) });
    await screen.findByText("Running");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog", { name: "Discard changes?" })).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();

    view.unmount();
    const dirtyClose = vi.fn();
    renderModal({ onClose: dirtyClose, sourceEntry: timeEntry({ stoppedAt: null, durationSeconds: 3_600 }) });
    const start = await screen.findByLabelText("Start time");
    fireEvent.change(start, { target: { value: "08:30" } });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("alertdialog", { name: "Discard changes?" })).not.toBeNull();
    expect(dirtyClose).not.toHaveBeenCalled();
  });
});

function renderModal({
  onClose = vi.fn(),
  onDelete,
  onSave = vi.fn<SaveHandler>().mockResolvedValue({ ok: true }),
  sourceEntry = timeEntry()
}: {
  onClose?: () => void;
  onDelete?: DeleteHandler;
  onSave?: SaveHandler;
  sourceEntry?: TimeEntryRow;
} = {}) {
  return render(createElement(TimeEntryQuickEditorModal, {
    capturedNow: new Date("2026-08-04T12:00:00.000Z"),
    categories: [],
    entry: sourceEntry,
    isTimerBusy: false,
    onClose,
    onDelete,
    onSave,
    peerEntries: [],
    tags: [
      { id: "planning", name: "Planning", normalizedName: "planning", usageCount: 2 },
      { id: "deep-work", name: "Deep work", normalizedName: "deep work", usageCount: 1 }
    ]
  }));
}

function promiseController<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function timeEntry(overrides: Partial<TimeEntryRow> = {}): TimeEntryRow {
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
    tags: [{ id: "planning", name: "Planning", normalizedName: "planning" }],
    ...overrides
  };
}

function localIso(value: string) {
  const iso = dateTimeLocalInputToIso(value);
  if (!iso) throw new Error(`Bad test date: ${value}`);
  return iso;
}
