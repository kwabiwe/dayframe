// @vitest-environment jsdom

import { createElement, useState, type ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("titles the editor 'Edit block' or 'Running block' under a day or Recording eyebrow, never repeating the description", async () => {
    const completed = renderModal({ sourceEntry: timeEntry({ description: "Sleep" }) });
    const completedEditor = await screen.findByTestId("time-entry-quick-editor");
    expect(completedEditor.querySelector(".calendar-compact-editor-header h2")?.textContent).toBe("Edit block");
    expect(completedEditor.querySelector(".calendar-compact-editor-header")?.textContent).not.toContain("Sleep");
    expect(completedEditor.querySelector(".df-ed-eyebrow")?.textContent).toMatch(/^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+$/);
    expect((screen.getByLabelText("Description") as HTMLInputElement).value).toBe("Sleep");

    completed.unmount();
    renderModal({ sourceEntry: timeEntry({ description: null, stoppedAt: null }) });
    const runningEditor = await screen.findByTestId("time-entry-quick-editor");
    expect(runningEditor.querySelector(".calendar-compact-editor-header h2")?.textContent).toBe("Running block");
    expect(runningEditor.querySelector(".df-ed-eyebrow")?.textContent).toBe("Recording");
    expect(runningEditor.querySelector(".calendar-compact-editor-header")?.textContent).not.toContain("Untitled entry");
  });

  it("splits a finished block at a line moved a minute at a time, and duplicates it (card G)", async () => {
    const onSplit = vi.fn<(atMs: number) => Promise<{ ok: true }>>(async () => ({ ok: true as const }));
    const onDuplicate = vi.fn(async () => ({ ok: true as const }));
    const onClose = vi.fn();
    render(createElement(TimeEntryQuickEditorModal, { ...modalProps({ onClose }), onSplit, onDuplicate }));
    await screen.findByTestId("time-entry-quick-editor");
    const split = screen.getByRole("button", { name: "Split Plan release" });
    expect(split.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(split);
    expect(split.getAttribute("aria-expanded")).toBe("true");
    const line = screen.getByRole("slider", { name: "Split at" }) as HTMLInputElement;
    // The line starts in the middle, has focus, and moves on whole minutes, never closer than a minute to an end.
    await waitFor(() => expect(document.activeElement).toBe(line));
    expect(Number(line.value)).toBe(Date.parse("2026-08-04T09:30:00.000Z"));
    expect(Number(line.step)).toBe(60_000);
    expect(Number(line.min)).toBe(Date.parse("2026-08-04T09:01:00.000Z"));
    expect(Number(line.max)).toBe(Date.parse("2026-08-04T09:59:00.000Z"));
    fireEvent.change(line, { target: { value: String(Date.parse("2026-08-04T09:24:00.000Z")) } });
    expect(screen.getByRole("group", { name: "Split this block" }).textContent).toMatch(/24m.*36m/);
    // "Keep as one" closes it and gives focus back to Split.
    fireEvent.click(screen.getByRole("button", { name: "Keep as one" }));
    // The row closes (it stays drawn, inert, only while its close runs: jsdom never ends a transition).
    const row = document.querySelector(".calendar-compact-split-wrap");
    expect(row?.getAttribute("data-open")).toBe("false");
    expect(row?.hasAttribute("inert")).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(split));
    fireEvent.click(split);
    fireEvent.change(screen.getByRole("slider", { name: "Split at" }), { target: { value: String(Date.parse("2026-08-04T09:40:00.000Z")) } });
    fireEvent.click(screen.getByRole("button", { name: /^Split at / }));
    await waitFor(() => expect(onSplit).toHaveBeenCalledWith(Date.parse("2026-08-04T09:40:00.000Z")));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    cleanup();
    render(createElement(TimeEntryQuickEditorModal, { ...modalProps({}), onSplit, onDuplicate }));
    fireEvent.click(await screen.findByRole("button", { name: "Duplicate Plan release" }));
    await waitFor(() => expect(onDuplicate).toHaveBeenCalledTimes(1));
  });

  it("offers no split while a block is running, and keeps it shut while the editor has unsaved changes (card G)", async () => {
    const onSplit = vi.fn<(atMs: number) => Promise<{ ok: true }>>(async () => ({ ok: true as const }));
    const running = render(createElement(TimeEntryQuickEditorModal, { ...modalProps({ sourceEntry: timeEntry({ stoppedAt: null }) }), onSplit }));
    await screen.findByTestId("time-entry-quick-editor");
    expect(screen.queryByRole("button", { name: /^Split / })).toBeNull();
    running.unmount();
    render(createElement(TimeEntryQuickEditorModal, { ...modalProps({}), onSplit }));
    fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "Plan the launch" } });
    expect((screen.getByRole("button", { name: /^Split / }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes the description's suggestions when Split opens, so they never sit over its row (card G)", async () => {
    const onSplit = vi.fn<(atMs: number) => Promise<{ ok: true }>>(async () => ({ ok: true as const }));
    render(createElement(TimeEntryQuickEditorModal, {
      ...modalProps({ sourceEntry: timeEntry({ categoryId: null, categoryName: null, description: null, tagNames: [], tags: [] }) }), onSplit
    }));
    expect(await screen.findByRole("listbox", { name: "Suggestions" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Split / }));
    expect(screen.getByRole("slider", { name: "Split at" })).toBeTruthy();
    expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull();
  });

  it("closes only the split row on Escape from any of its controls, and never splits over unsaved edits (Codex r1 on #596)", async () => {
    const onSplit = vi.fn<(atMs: number) => Promise<{ ok: true }>>(async () => ({ ok: true as const }));
    const onClose = vi.fn();
    render(createElement(TimeEntryQuickEditorModal, { ...modalProps({ onClose }), onSplit }));
    const split = await screen.findByRole("button", { name: "Split Plan release" });
    fireEvent.click(split);
    const keep = screen.getByRole("button", { name: "Keep as one" });
    keep.focus();
    fireEvent.keyDown(keep, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(split));
    expect(split.getAttribute("aria-expanded")).toBe("false");
    expect(onClose).not.toHaveBeenCalled();
    // Opened, then the description changed: the split would act on the block as saved, so it waits.
    fireEvent.click(split);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Plan the launch" } });
    const confirm = screen.getByRole("button", { name: /^Split at / }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Split at" }), { key: "Enter" });
    expect(onSplit).not.toHaveBeenCalled();
  });

  it("says where an auto-logged visit's block came from, and nothing for other blocks (PRD D17)", async () => {
    const auto = renderModal({ sourceEntry: timeEntry({ source: "location_auto_log", placeName: "Gym" } as Partial<TimeEntryRow>) });
    expect((await screen.findByTestId("time-entry-source")).textContent).toBe("Logged automatically · Gym");
    auto.unmount();
    renderModal({ sourceEntry: timeEntry({ source: "manual_app", placeName: "Gym" } as Partial<TimeEntryRow>) });
    await screen.findByTestId("time-entry-quick-editor");
    expect(screen.queryByTestId("time-entry-source")).toBeNull();
  });

  it("opens and applies suggestions for empty Uncategorized completed and running entries", async () => {
    for (const stoppedAt of ["2026-08-04T10:00:00.000Z", null]) {
      const view = renderModal({
        sourceEntry: timeEntry({ categoryId: null, categoryName: null, description: null, stoppedAt, tagNames: [], tags: [] })
      });
      const description = await screen.findByLabelText("Description") as HTMLInputElement;
      const suggestions = await screen.findByRole("listbox", { name: "Suggestions" });

      expect(description.value).toBe("");
      // The listbox sits inside the FloatingList surface, which is portalled to the body.
      expect(suggestions.closest(".df-flist")?.parentElement).toBe(document.body);
      expect(suggestions.textContent).toContain("Deep planning");
      fireEvent.keyDown(description, { key: "ArrowDown" });
      expect(document.activeElement?.textContent).toContain("Deep planning");
      await userEvent.keyboard("{Enter}");

      expect(description.value).toBe("Deep planning");
      expect(screen.getByRole("button", { name: "#Deep work, remove tag" })).not.toBeNull();
      expect(screen.getByRole("radio", { name: /Focus/ }).getAttribute("aria-checked")).toBe("true");
      await waitFor(() => expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull());
      view.unmount();
    }
  });

  it("reopens suggestions when an existing description is cleared", async () => {
    renderModal();
    const description = await screen.findByLabelText("Description") as HTMLInputElement;

    expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull();
    fireEvent.change(description, { target: { value: "" } });

    expect(await screen.findByRole("listbox", { name: "Suggestions" })).not.toBeNull();
  });

  it("closes on the first Escape when there is nothing to suggest (Codex r2 on #468)", async () => {
    const onClose = vi.fn();
    renderModal({
      onClose,
      sourceEntry: timeEntry({ categoryId: null, categoryName: null, description: null, tagNames: [], tags: [] }),
      withSuggestions: false
    });
    const description = await screen.findByLabelText("Description");
    fireEvent.focus(description);
    expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("closes a visible Suggestions list on the first Escape and the editor on the second", async () => {
    const onClose = vi.fn();
    renderModal({ onClose, sourceEntry: timeEntry({ categoryId: null, categoryName: null, description: null, tagNames: [], tags: [] }) });
    await screen.findByRole("listbox", { name: "Suggestions" });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("hydrates, removes and selects tags and saves one Place-safe partial payload", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn<SaveHandler>().mockResolvedValue({ ok: true });
    renderModal({ onClose, onSave });

    expect(await screen.findByTestId("time-entry-quick-editor-modal")).not.toBeNull();
    expect(screen.getByRole("button", { name: "#Planning, remove tag" })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Choose Start date/ }).textContent).not.toBe("");
    expect(screen.getByRole("button", { name: /Choose End date/ }).textContent).not.toBe("");

    await userEvent.click(screen.getByRole("button", { name: "#Planning, remove tag" }));
    await userEvent.click(screen.getByRole("button", { name: "Add or filter tags" }));
    const picker = await screen.findByRole("listbox", { name: "Tags" });
    await userEvent.click(within(picker).getByRole("option", { name: "#Deep work" }));
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
    expect(await screen.findByRole("listbox", { name: "Tags" })).not.toBeNull();
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
    const description = await screen.findByLabelText("Description");
    await userEvent.type(description, " updated");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("alertdialog", { name: "Discard unsaved changes?" }, { timeout: 3000 })).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));

    fireEvent.mouseDown(screen.getByTestId("time-entry-quick-editor-modal"));
    expect(await screen.findByRole("alertdialog", { name: "Discard unsaved changes?" }, { timeout: 3000 })).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("returns focus to its opener after a Discard under Reduce Motion, past the confirmation's inert page (Codex r2 on #469)", async () => {
    // jsdom ignores inert when focusing; browsers refuse focus inside an inert subtree.
    // (user-event may already have turned focus into an accessor.)
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "focus")!;
    const inertAware = (focus: HTMLElement["focus"]) => function inertAwareFocus(this: HTMLElement, options?: FocusOptions) {
      if (this.closest("[inert]")) return;
      focus.call(this, options);
    };
    Object.defineProperty(HTMLElement.prototype, "focus", "value" in original
      ? { ...original, value: inertAware(original.value as HTMLElement["focus"]) }
      : { ...original, get(this: HTMLElement) { return inertAware(original.get!.call(this) as HTMLElement["focus"]); } });
    try {
      function Host() {
        const [open, setOpen] = useState(false);
        return createElement("div", null,
          createElement("button", { onClick: () => setOpen(true), type: "button" }, "Open editor"),
          open ? createElement(TimeEntryQuickEditorModal, modalProps({ onClose: () => setOpen(false) })) : null
        );
      }
      render(createElement(Host));
      const opener = screen.getByRole("button", { name: "Open editor" });
      opener.focus();
      fireEvent.click(opener);
      const description = await screen.findByLabelText("Description");
      await userEvent.type(description, " updated");
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await screen.findByRole("alertdialog", { name: "Discard unsaved changes?" }, { timeout: 3000 });
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));

      await waitFor(() => expect(screen.queryByTestId("time-entry-quick-editor-modal")).toBeNull());
      expect(document.body.querySelector("[inert]:not(.df-confirm-layer)")).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(opener));
    } finally {
      Object.defineProperty(HTMLElement.prototype, "focus", original);
    }
  });

  it("saves the complete valid draft once from plain Enter in Description and exits", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn<SaveHandler>().mockResolvedValue({ ok: true });
    renderModal({ onClose, onSave });
    const start = await screen.findByLabelText("Start time");
    const description = screen.getByLabelText("Description");

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
    const finish = await screen.findByLabelText("End time") as HTMLInputElement;

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
    const description = await screen.findByLabelText("Description");

    fireEvent.keyDown(description, { key: "Enter" });

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the draft open after Enter save failure", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn<SaveHandler>().mockResolvedValue({ ok: false, error: "Server rejected the update." });
    renderModal({ onClose, onSave });
    const description = await screen.findByLabelText("Description") as HTMLInputElement;
    fireEvent.change(description, { target: { value: "Keep this draft" } });
    fireEvent.keyDown(description, { key: "Enter" });

    expect((await screen.findByRole("alert")).textContent).toContain("Server rejected the update");
    expect(description.value).toBe("Keep this draft");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("gives hashtag selection, modifiers, and IME composition precedence over Enter save", async () => {
    const onSave = vi.fn<SaveHandler>().mockResolvedValue({ ok: true });
    renderModal({ onSave });
    const description = await screen.findByLabelText("Description");

    for (const modifier of ["shiftKey", "ctrlKey", "altKey", "metaKey"] as const) {
      fireEvent.keyDown(description, { key: "Enter", [modifier]: true });
    }
    fireEvent.keyDown(description, { key: "Enter", isComposing: true });
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(description, { target: { value: "#Pla", selectionStart: 4 } });
    fireEvent.keyUp(description, { key: "a" });
    await screen.findByRole("listbox");
    fireEvent.keyDown(description, { key: "Enter" });
    expect(screen.getByRole("button", { name: "#Planning, remove tag" })).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("mutation-gates rapid Description Enter presses", async () => {
    let resolveSave!: (value: { ok: true }) => void;
    const onSave = vi.fn<SaveHandler>().mockImplementation(() => new Promise((resolve) => {
      resolveSave = resolve;
    }));
    renderModal({ onSave });
    const description = await screen.findByLabelText("Description");
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
    const description = screen.getByLabelText("Description") as HTMLInputElement;

    await user.clear(description);
    await user.type(description, "Captured before save{Enter}");
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

    expect(editor.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Saving block…");
    expect(description.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "#Planning, remove tag" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add or filter tags" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /All activities/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Start time") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("End time") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Duration") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Delete Plan release/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Close editor" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);

    await user.type(description, " late edit");
    await user.click(screen.getByRole("button", { name: "#Planning, remove tag" }));
    expect(description.value).toBe("Captured before save");
    expect(screen.getByRole("button", { name: "#Planning, remove tag" })).not.toBeNull();

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
    expect(screen.getByRole("status").textContent).toBe("Deleting block…");
    expect((screen.getByLabelText("Description") as HTMLInputElement).disabled).toBe(true);
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
    expect(screen.queryByRole("alertdialog", { name: "Discard unsaved changes?" })).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();

    view.unmount();
    const dirtyClose = vi.fn();
    renderModal({ onClose: dirtyClose, sourceEntry: timeEntry({ stoppedAt: null, durationSeconds: 3_600 }) });
    const start = await screen.findByLabelText("Start time");
    fireEvent.change(start, { target: { value: "08:30" } });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("alertdialog", { name: "Discard unsaved changes?" }, { timeout: 3000 })).not.toBeNull();
    expect(dirtyClose).not.toHaveBeenCalled();
  });

  it("keeps a chip chosen through All activities, and its focus, when it is cleared (Codex r1 on #305)", async () => {
    const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "Ninth"];
    renderModal({ categories: names.map((name) => ({ id: name.toLowerCase(), name, color: "mint", isPinned: false })) });
    await screen.findByTestId("time-entry-quick-editor");
    const menu = document.getElementById("time-entry-quick-category-menu") as HTMLElement;
    // The same FloatingList as the timer's Activities list (WUI-024): mounted, hidden and inert while closed.
    expect(menu.closest("[inert]")).not.toBeNull();
    expect(screen.queryByRole("radio", { name: "Ninth" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /All activities/ }));
    const search = await screen.findByRole("combobox", { name: "Search activities" });
    await userEvent.type(search, "nin{Enter}");
    const ninth = await screen.findByRole("radio", { name: "Ninth" });
    expect(ninth.getAttribute("aria-checked")).toBe("true");
    // Choosing closes the picker, which hands focus back to All activities on the next frame.
    await waitFor(() => expect(document.activeElement?.textContent).toContain("All activities"));

    ninth.focus();
    await userEvent.keyboard(" ");
    const kept = screen.getByRole("radio", { name: "Ninth" });
    expect(kept.getAttribute("aria-checked")).toBe("false");
    expect(document.activeElement).toBe(kept);
  });

  it("leaves input-method keys to the input method and reopens All activities on the chosen one (Codex r2 on #305)", async () => {
    const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "Ninth"];
    renderModal({ categories: names.map((name) => ({ id: name.toLowerCase(), name, color: "mint", isPinned: false })) });
    await screen.findByTestId("time-entry-quick-editor");
    const trigger = screen.getByRole("button", { name: /All activities/ });
    await userEvent.click(trigger);
    const search = await screen.findByRole("combobox", { name: "Search activities" });
    search.focus();
    fireEvent.keyDown(search, { key: "ArrowDown", keyCode: 229, isComposing: true });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: "Escape", keyCode: 229, isComposing: true });
    expect(document.activeElement).toBe(search);
    expect(screen.getByRole("combobox", { name: "Search activities" })).not.toBeNull();

    await userEvent.type(search, "nin{Enter}");
    await screen.findByRole("radio", { name: "Ninth" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    // Focus stays in the list's search field; the chosen activity is the highlighted option.
    await waitFor(() => {
      const field = screen.getByRole("combobox", { name: "Search activities" });
      expect(document.activeElement).toBe(field);
      expect(document.getElementById(field.getAttribute("aria-activedescendant") ?? "")?.textContent).toContain("Ninth");
    });
  });
});

function renderModal({
  categories = [{ id: "focus", name: "Focus", color: "mint", isPinned: false }],
  onClose = vi.fn(),
  onDelete,
  onSave = vi.fn<SaveHandler>().mockResolvedValue({ ok: true }),
  sourceEntry = timeEntry(),
  withSuggestions = true
}: {
  categories?: Array<{ id: string; name: string; color: string; isPinned: boolean }>;
  onClose?: () => void;
  onDelete?: DeleteHandler;
  onSave?: SaveHandler;
  sourceEntry?: TimeEntryRow;
  withSuggestions?: boolean;
} = {}) {
  return render(createElement(TimeEntryQuickEditorModal, modalProps({ categories, onClose, onDelete, onSave, sourceEntry, withSuggestions })));
}

function modalProps({
  categories = [{ id: "focus", name: "Focus", color: "mint", isPinned: false }],
  onClose = vi.fn(),
  onDelete,
  onSave = vi.fn<SaveHandler>().mockResolvedValue({ ok: true }),
  sourceEntry = timeEntry(),
  withSuggestions = true
}: {
  categories?: Array<{ id: string; name: string; color: string; isPinned: boolean }>;
  onClose?: () => void;
  onDelete?: DeleteHandler;
  onSave?: SaveHandler;
  sourceEntry?: TimeEntryRow;
  withSuggestions?: boolean;
} = {}): ComponentProps<typeof TimeEntryQuickEditorModal> {
  return {
    capturedNow: new Date("2026-08-04T12:00:00.000Z"),
    categories,
    entry: sourceEntry,
    isTimerBusy: false,
    onClose,
    onDelete,
    onSave,
    peerEntries: [],
    taskSuggestions: withSuggestions ? [{
      key: "deep-planning",
      categoryId: "focus",
      categoryName: "Focus",
      categoryColor: "mint",
      description: "Deep planning",
      lastSeenAt: "2026-08-04T08:00:00.000Z",
      score: 10,
      section: "recent",
      useCount: 3,
      totalSeconds: 10_800,
      tagNames: ["Deep work"]
    }] : [],
    tags: [
      { id: "planning", name: "Planning", normalizedName: "planning", usageCount: 2 },
      { id: "deep-work", name: "Deep work", normalizedName: "deep work", usageCount: 1 }
    ]
  };
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
