// @vitest-environment jsdom

import { useState, type FormEvent } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CategoryRow } from "@/lib/queries";
import { CategoryPicker, type CreateCategoryOutcome } from "./CategoryPicker";

const workCategory: CategoryRow = {
  id: "20000000-0000-4000-8000-000000000001",
  name: "Work",
  color: "blue",
  isPinned: true
};
const writingCategory: CategoryRow = {
  id: "20000000-0000-4000-8000-000000000002",
  name: "Writing",
  color: "purple",
  isPinned: false
};

describe("CategoryPicker", () => {
  afterEach(() => cleanup());

  it("prevents blank and duplicate names and gives Escape back to the picker before closing it", async () => {
    const create = vi.fn<(name: string) => Promise<CreateCategoryOutcome>>();
    render(<PickerHarness create={create} />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: /Uncategorized/ });

    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Create new category" }));
    const dialog = screen.getByRole("dialog", { name: "Create new category" });
    const input = within(dialog).getByRole("textbox", { name: "Name" });
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Enter a category name.");
    expect(create).not.toHaveBeenCalled();

    await user.type(input, "work");
    await user.keyboard("{Enter}");
    expect((await within(dialog).findByRole("alert")).textContent).toContain("already exists");
    expect(create).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("option", { name: "Create new category" })));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    await user.click(screen.getByRole("option", { name: "Create new category" }));
    const reopenedDialog = screen.getByRole("dialog", { name: "Create new category" });
    await waitFor(() => expect(document.activeElement).toBe(within(reopenedDialog).getByRole("textbox", { name: "Name" })));
    await user.tab();
    expect(document.activeElement).toBe(within(reopenedDialog).getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("option", { name: "Create new category" })));

    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("preserves the surrounding draft after failure, retries, selects the category, and publishes it to another picker", async () => {
    const create = vi.fn<(name: string) => Promise<CreateCategoryOutcome>>()
      .mockResolvedValueOnce({ ok: false, error: "Category creation failed. Try again." })
      .mockResolvedValueOnce({ ok: true, category: writingCategory });
    const submit = vi.fn((event: FormEvent) => event.preventDefault());
    render(<PickerHarness create={create} onSubmit={submit} secondPicker />);
    const user = userEvent.setup();
    const description = screen.getByLabelText("Description") as HTMLInputElement;
    const tags = screen.getByLabelText("Tags") as HTMLInputElement;
    const start = screen.getByLabelText("Start") as HTMLInputElement;
    const finish = screen.getByLabelText("Finish") as HTMLInputElement;
    await user.type(description, "Draft proposal");
    await user.type(tags, "planning, client");
    await user.clear(start);
    await user.type(start, "2026-08-11T09:15");
    await user.clear(finish);
    await user.type(finish, "2026-08-11T10:45");

    const firstTrigger = screen.getByTestId("first-picker").querySelector("button") as HTMLButtonElement;
    await user.click(firstTrigger);
    await user.click(screen.getByRole("option", { name: "Create new category" }));
    const input = screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;
    await user.type(input, "  Writing  ");
    await user.keyboard("{Enter}");

    expect((await screen.findByRole("alert")).textContent).toContain("Category creation failed");
    expect(input.value).toBe("  Writing  ");
    expect(document.activeElement).toBe(input);
    expect(description.value).toBe("Draft proposal");
    expect(tags.value).toBe("planning, client");
    expect(start.value).toBe("2026-08-11T09:15");
    expect(finish.value).toBe("2026-08-11T10:45");
    expect(submit).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(firstTrigger.textContent).toContain("Writing"));
    expect(create).toHaveBeenNthCalledWith(1, "Writing");
    expect(create).toHaveBeenNthCalledWith(2, "Writing");
    expect(submit).not.toHaveBeenCalled();

    const secondTrigger = screen.getByTestId("second-picker").querySelector("button") as HTMLButtonElement;
    await user.click(secondTrigger);
    expect(screen.getByRole("option", { name: "Writing" })).not.toBeNull();
  });

  it("portals the menu to the body without losing panel-aware focus and outside-click handling", async () => {
    render(<PickerHarness create={vi.fn()} portal />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: /Uncategorized/ });
    const field = screen.getByTestId("first-picker");

    await user.click(trigger);
    const menu = document.getElementById("first-category-menu");
    expect(menu?.parentElement).toBe(document.body);
    expect(field.contains(menu)).toBe(false);
    expect(menu?.classList.contains("time-entry-quick-editor-nested-surface")).toBe(true);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Uncategorized" }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Create new category" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "After picker" }));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger);

    const work = screen.getByRole("option", { name: "Work" });
    work.focus();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.mouseDown(work);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
  });

  it("portals into the nearest native dialog and owns Escape before the outer editor", async () => {
    const onOuterKeyDown = vi.fn();
    render(<PickerHarness create={vi.fn()} nativeDialog onOuterKeyDown={onOuterKeyDown} portal />);
    const user = userEvent.setup();
    const outerDialog = screen.getByRole("dialog", { name: "Add Time" });
    const trigger = screen.getByRole("button", { name: /Uncategorized/ });

    await user.click(trigger);
    const menu = document.getElementById("first-category-menu");
    expect(menu?.parentElement).toBe(outerDialog);
    expect(screen.getByTestId("first-picker").contains(menu)).toBe(false);

    await user.click(screen.getByRole("option", { name: "Create new category" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("option", { name: "Create new category" })));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(onOuterKeyDown).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
    expect(onOuterKeyDown).not.toHaveBeenCalled();
  });
});

function PickerHarness({
  create,
  nativeDialog = false,
  onSubmit,
  onOuterKeyDown,
  portal = false,
  secondPicker = false
}: {
  create: (name: string) => Promise<CreateCategoryOutcome>;
  nativeDialog?: boolean;
  onSubmit?: (event: FormEvent) => void;
  onOuterKeyDown?: () => void;
  portal?: boolean;
  secondPicker?: boolean;
}) {
  const [categories, setCategories] = useState([workCategory]);
  const [firstSelectedId, setFirstSelectedId] = useState("");
  const [secondSelectedId, setSecondSelectedId] = useState("");
  const [firstOpen, setFirstOpen] = useState(false);
  const [secondOpen, setSecondOpen] = useState(false);

  async function createAndPublish(name: string) {
    const outcome = await create(name);
    if (outcome.ok) setCategories((current) => [...current, outcome.category]);
    return outcome;
  }

  const form = (
    <form onSubmit={onSubmit}>
      <label>Description<input aria-label="Description" /></label>
      <label>Tags<input aria-label="Tags" /></label>
      <label>Start<input aria-label="Start" defaultValue="2026-08-11T09:00" /></label>
      <label>Finish<input aria-label="Finish" defaultValue="2026-08-11T10:00" /></label>
      <div data-testid="first-picker">
        <CategoryPicker
          categories={categories}
          menuId="first-category-menu"
          onCreateCategory={createAndPublish}
          onOpenChange={setFirstOpen}
          onSelect={setFirstSelectedId}
          open={firstOpen}
          portal={portal}
          selectedId={firstSelectedId}
          variant="timer"
        />
      </div>
      <button type="button">After picker</button>
      {secondPicker ? (
        <div data-testid="second-picker">
          <CategoryPicker
            categories={categories}
            menuId="second-category-menu"
            onCreateCategory={createAndPublish}
            onOpenChange={setSecondOpen}
            onSelect={setSecondSelectedId}
            open={secondOpen}
            portal={portal}
            selectedId={secondSelectedId}
            variant="quick"
          />
        </div>
      ) : null}
    </form>
  );

  return nativeDialog ? (
    <dialog aria-label="Add Time" onKeyDown={onOuterKeyDown} open>{form}</dialog>
  ) : form;
}
