// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, CategoryRow, TimeEntryRow } from "@/lib/queries";
import { timerDraftEditedFields, timerDraftForEntry, type TimerDraft } from "@/lib/timer-runtime";

// Owner, 14 Oct 2026 (Trello "Suggestions, tags, and activities floating panels"): the command
// timer's Activity block and Tags button open the same Activities and Tags lists as typing `@` and
// `#` (#391's FloatingList), with a search field at the top, instead of the old "Activity for this
// block" chip grid and tag picker dialog.

let runtime: Record<string, unknown>;

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => runtime
}));

const { PersistentTimerBar } = await import("./PersistentTimerBar");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const ACTIVITIES: CategoryRow[] = [
  { id: "focus", name: "Focus", color: "mint", isPinned: true },
  { id: "write", name: "Writing", color: "blue", isPinned: false }
];

const TAGS = [
  { id: "admin", name: "Admin", normalizedName: "admin", usageCount: 5 },
  { id: "deep-work", name: "Deep work", normalizedName: "deep-work", usageCount: 2 }
];

function renderBar({
  activeEntry = null,
  categories = ACTIVITIES,
  categoryId = "",
  createCategory,
  tagNames = [],
  tags = TAGS
}: {
  activeEntry?: TimeEntryRow | null;
  categories?: CategoryRow[];
  categoryId?: string;
  createCategory?: ReturnType<typeof vi.fn>;
  tagNames?: string[];
  tags?: typeof TAGS;
} = {}) {
  const calls = {
    createCategory: createCategory ?? vi.fn().mockResolvedValue({
      ok: true,
      category: { id: "reading", name: "Reading", color: "teal", isPinned: false }
    }),
    setTimerDraft: vi.fn(),
    startTimer: vi.fn().mockResolvedValue({ ok: true }),
    stopTimer: vi.fn().mockResolvedValue({ ok: true }),
    updateActiveDetails: vi.fn().mockResolvedValue({ ok: true })
  };
  const data = {
    activeEntry,
    categories,
    categoryUsage: [],
    dateRange: { selectedDate: "2026-08-14" },
    entries: activeEntry ? [activeEntry] : [],
    tags,
    taskSuggestions: []
  } as unknown as BootstrapData;

  function Harness() {
    const [timerDraft, setDraft] = useState<TimerDraft>({
      categoryId: activeEntry?.categoryId ?? categoryId,
      description: activeEntry?.description ?? "",
      tagNames: activeEntry?.tagNames ?? tagNames
    });
    runtime = {
      clearTimerError: vi.fn(),
      closeManualEntry: vi.fn(),
      createCategory: calls.createCategory,
      createManualEntry: vi.fn().mockResolvedValue({ ok: true }),
      deleteActiveTimer: vi.fn().mockResolvedValue({ ok: true }),
      isManualEntryOpen: false,
      isTimerBusy: false,
      openManualEntry: vi.fn(),
      setTimerDraft: (next: TimerDraft | ((current: TimerDraft) => TimerDraft)) => {
        calls.setTimerDraft(next);
        setDraft(next);
      },
      shellData: data,
      startTimer: calls.startTimer,
      stopTimer: calls.stopTimer,
      timerDraft,
      timerDraftEdited: activeEntry ? timerDraftEditedFields(timerDraft, timerDraftForEntry(activeEntry)).length > 0 : false,
      timerError: null,
      updateActiveDetails: calls.updateActiveDetails,
      updateActiveStartTime: vi.fn().mockResolvedValue({ ok: true })
    };
    return <PersistentTimerBar />;
  }

  render(<Harness />);
  return { calls };
}

function running(overrides: Partial<TimeEntryRow> = {}): TimeEntryRow {
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
    description: "Fix bug",
    startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    stoppedAt: null,
    updatedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    durationSeconds: 1_200,
    tagNames: [],
    tags: [],
    ...overrides
  };
}

function phone() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 560px)",
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }));
}

const activityButton = () => screen.getByRole("button", { name: /^Activity: / });
const tagsButton = () => screen.getByRole("button", { name: "Add or filter tags" });
const listbox = (name: "Activities" | "Tags") => screen.getByRole("listbox", { name });
const surfaceOf = (list: HTMLElement) => list.closest<HTMLElement>(".df-flist")!;
// The visible label of each row (the muted metadata beside it, a count or "Pinned", is not part of it).
const labels = (list: HTMLElement) => within(list).queryAllByRole("option").map((option) => option.querySelector(".df-flist-label")?.textContent);
const footer = (list: HTMLElement) => [...surfaceOf(list).querySelectorAll(".df-flist-foot kbd")].map((kbd) => kbd.textContent);

async function openActivities(user = userEvent.setup()) {
  await user.click(activityButton());
  const search = screen.getByRole("combobox", { name: "Search activities" }) as HTMLInputElement;
  await waitFor(() => expect(document.activeElement).toBe(search));
  return { search, user };
}

async function openTags(user = userEvent.setup()) {
  await user.click(tagsButton());
  const search = screen.getByRole("combobox", { name: "Search tags" }) as HTMLInputElement;
  await waitFor(() => expect(document.activeElement).toBe(search));
  return { search, user };
}

describe("the Activity block opens the shared Activities list", () => {
  it("is the #391 FloatingList with a search field, the same rows and hints, named by visible text", async () => {
    renderBar();
    const { search } = await openActivities();
    const list = listbox("Activities");
    const surface = surfaceOf(list);
    expect(surface.className).toContain("df-flist");
    expect(surface.className).toContain("df-cmd-activity-panel");
    expect(surface.querySelector(".df-flist-head")?.textContent).toBe("Activities");
    expect(labels(list)).toEqual(["No activity", "Focus", "Writing", "Create new activity"]);
    for (const option of within(list).getAllByRole("option").slice(0, 3)) {
      expect(option.className).toContain("df-flist-row df-flist-row--activity");
    }
    // Names are the visible label; "Pinned" is the pinned activity's description, not its name.
    const focus = within(list).getByRole("option", { name: "Focus" });
    expect(focus.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(focus.getAttribute("aria-describedby")!)?.textContent).toBe("Pinned");
    expect(within(list).getByRole("option", { name: "Writing" }).getAttribute("aria-describedby")).toBeNull();
    expect(footer(list)).toEqual(["↑↓", "↵"]);
    // The search field is the combobox for the rows; the button names what it opens.
    expect(search.getAttribute("aria-controls")).toBe(list.id);
    expect(search.getAttribute("aria-expanded")).toBe("true");
    expect(activityButton().getAttribute("aria-expanded")).toBe("true");
    expect(activityButton().getAttribute("aria-controls")).toBe(list.id);
    // The old chip grid is gone.
    expect(screen.queryByText("Activity for this block")).toBeNull();
  });

  it("↑/↓ move the highlight from the current activity, Enter picks it and focus returns to the block", async () => {
    const { calls } = renderBar();
    const { search, user } = await openActivities();
    const options = within(listbox("Activities")).getAllByRole("option");
    // Opens on the current choice ("No activity"), which is the selected option.
    expect(search.getAttribute("aria-activedescendant")).toBe(options[0].id);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(search.getAttribute("aria-activedescendant")).toBe(options[2].id);
    expect(options[2].className).toContain("is-highlighted");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(search.getAttribute("aria-activedescendant")).toBe(options[0].id);
    await user.keyboard("{ArrowUp}");
    expect(search.getAttribute("aria-activedescendant")).toBe(options[3].id);
    await user.keyboard("{ArrowUp}{ArrowUp}{Enter}");

    expect(screen.getByRole("button", { name: "Activity: Focus" })).not.toBeNull();
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(activityButton()));
    // Enter in the search never submits the bar (no Start).
    expect(calls.startTimer).not.toHaveBeenCalled();
  });

  it("Escape closes the list, changes nothing and returns focus to the block", async () => {
    const { calls } = renderBar();
    const { user } = await openActivities();
    await user.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    expect(screen.getByRole("button", { name: "Activity: No activity" })).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(activityButton()));
    expect(calls.setTimerDraft).not.toHaveBeenCalled();
  });

  it("filters with the @ list's resolver, offers Create for a new name, and picks No activity", async () => {
    renderBar();
    const { search, user } = await openActivities();
    await user.type(search, "wr");
    expect(labels(listbox("Activities"))).toEqual(["Writing", "Create “wr”"]);
    await user.clear(search);
    await user.type(search, "focus");
    // The exact name exists: no Create row.
    expect(labels(listbox("Activities"))).toEqual(["Focus"]);
    await user.clear(search);
    await user.type(search, "zz");
    expect(listbox("Activities").textContent).toContain("No activity called “zz”");
    expect(labels(listbox("Activities"))).toEqual(["Create “zz”"]);

    await user.clear(search);
    await user.click(within(listbox("Activities")).getByRole("option", { name: "Writing" }));
    expect(screen.getByRole("button", { name: "Activity: Writing" })).not.toBeNull();
    await openActivities(user);
    const options = within(listbox("Activities")).getAllByRole("option");
    expect(within(listbox("Activities")).getByRole("option", { name: "Writing" }).getAttribute("aria-selected")).toBe("true");
    await user.click(options[0]);
    expect(screen.getByRole("button", { name: "Activity: No activity" })).not.toBeNull();
  });

  it("creates an activity from the button: Create “name” opens the name and colour form inside the list", async () => {
    const { calls } = renderBar();
    const { search, user } = await openActivities();
    await user.type(search, "Reading");
    await user.keyboard("{ArrowDown}");
    expect(search.getAttribute("aria-activedescendant")).toBe(
      within(listbox("Activities")).getByRole("option", { name: "Create “Reading”" }).id
    );
    await user.keyboard("{Enter}");
    const form = screen.getByRole("dialog", { name: "Create new activity" });
    expect(surfaceOf(form).className).toContain("df-cmd-activity-panel");
    const name = within(form).getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("Reading");
    expect(within(form).getByRole("button", { name: /Choose activity colour/ })).not.toBeNull();
    await user.click(within(form).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(calls.createCategory).toHaveBeenCalledWith("Reading", undefined));
    await waitFor(() => expect(calls.setTimerDraft).toHaveBeenCalled());
    const update = calls.setTimerDraft.mock.calls.at(-1)![0] as (current: TimerDraft) => TimerDraft;
    expect(update({ categoryId: "", description: "", tagNames: [] }).categoryId).toBe("reading");
    await waitFor(() => expect(document.activeElement).toBe(activityButton()));
  });

  it("Create new activity with nothing searched, and Escape in the form goes back to the list", async () => {
    renderBar();
    const { user } = await openActivities();
    await user.click(within(listbox("Activities")).getByRole("option", { name: "Create new activity" }));
    expect(screen.getByRole("dialog", { name: "Create new activity" })).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Create new activity" })).toBeNull();
    expect(listbox("Activities")).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Search activities" })));
  });

  it("while recording, a pick switches the running block's activity in place through autosave", async () => {
    const { calls } = renderBar({ activeEntry: running() });
    const { user } = await openActivities();
    await user.click(within(listbox("Activities")).getByRole("option", { name: "Writing" }));
    expect(screen.getByRole("button", { name: "Activity: Writing" })).not.toBeNull();
    await waitFor(() => expect(calls.updateActiveDetails).toHaveBeenCalledWith({
      categoryId: "write",
      description: "Fix bug",
      tagNames: []
    }));
    expect(calls.startTimer).not.toHaveBeenCalled();
    expect(calls.stopTimer).not.toHaveBeenCalled();
  });
});

describe("the Tags button opens the shared Tags list", () => {
  it("is the #391 FloatingList, multi-select, with a search field and the Tags hints", async () => {
    renderBar({ tagNames: ["Deep work"] });
    const { search } = await openTags();
    const list = listbox("Tags");
    const surface = surfaceOf(list);
    expect(surface.className).toContain("df-flist");
    expect(surface.className).toContain("inline-tag-picker");
    expect(surface.querySelector(".df-flist-head")?.textContent).toBe("Tags");
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    // Names are the visible "#name"; the count and the check are hidden from them.
    expect(within(list).getAllByRole("option").map((option) => option.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(within(list).getByRole("option", { name: "#Admin" }).className).toContain("df-flist-row df-flist-row--tag");
    const chosen = within(list).getByRole("option", { name: "#Deep work" });
    expect(chosen.className).toContain("is-checked");
    expect(chosen.querySelector(".df-flist-remove")).not.toBeNull();
    expect(footer(list)).toEqual(["↵", "⌫"]);
    expect(search.getAttribute("aria-controls")).toBe(list.id);
    expect(tagsButton().getAttribute("aria-haspopup")).toBe("listbox");
    expect(tagsButton().getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("dialog", { name: "Add or filter tags" })).toBeNull();
  });

  it("adds and removes several tags with ↑/↓ and Enter; Backspace in an empty search removes the last", async () => {
    const { calls } = renderBar();
    const { search, user } = await openTags();
    const draftTags = () => (calls.setTimerDraft.mock.calls.at(-1)![0] as (current: TimerDraft) => TimerDraft)({
      categoryId: "",
      description: "",
      tagNames: []
    }).tagNames;
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Remove tag Admin" })).not.toBeNull();
    expect(within(listbox("Tags")).getByRole("option", { name: "#Admin" }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowDown}");
    expect(search.getAttribute("aria-activedescendant")).toBe(within(listbox("Tags")).getByRole("option", { name: "#Deep work" }).id);
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Remove tag Deep work" })).not.toBeNull();
    expect(draftTags()).toEqual(["Admin", "Deep work"]);
    // Enter on a chosen tag removes it.
    await user.keyboard("{ArrowUp}{Enter}");
    expect(screen.queryByRole("button", { name: "Remove tag Admin" })).toBeNull();
    // Backspace in the empty search removes the last tag on the block.
    await user.keyboard("{Backspace}");
    expect(screen.queryByRole("button", { name: "Remove tag Deep work" })).toBeNull();
    expect(within(listbox("Tags")).getAllByRole("option").map((option) => option.getAttribute("aria-selected"))).toEqual(["false", "false"]);
    expect(document.activeElement).toBe(search);
    expect(calls.startTimer).not.toHaveBeenCalled();
  });

  it("filters, creates a tag with Create “#name”, and keeps the search focused", async () => {
    renderBar();
    const { search, user } = await openTags();
    await user.type(search, "dee");
    expect(labels(listbox("Tags"))).toEqual(["#Deep work", "Create “#dee”"]);
    await user.clear(search);
    await user.type(search, "launch");
    expect(listbox("Tags").textContent).not.toContain("No matching tags");
    const create = within(listbox("Tags")).getByRole("option", { name: "Create “#launch”" });
    expect(create.className).toContain("is-create");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Remove tag launch" })).not.toBeNull();
    expect(search.value).toBe("");
    // The new tag is listed, checked.
    expect(within(listbox("Tags")).getByRole("option", { name: "#launch" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(search);
  });

  it("Escape and Tab close the list and return focus to the Tags button", async () => {
    renderBar();
    const { user } = await openTags();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(tagsButton()));
    await openTags(user);
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(tagsButton()));
  });

  it("handles Escape in its search, so a surrounding dialog (Add time) never takes it and closes", async () => {
    renderBar();
    const { search } = await openTags();
    // fireEvent returns false when the event's default was prevented (what ModalDialog checks).
    expect(fireEvent.keyDown(search, { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(tagsButton()));
  });

  it("keeps the tag limit: unchosen tags are unavailable and Create is not offered", async () => {
    const full = Array.from({ length: 24 }, (_, index) => `t${index}`);
    renderBar({ tagNames: full });
    const { search, user } = await openTags();
    const admin = within(listbox("Tags")).getByRole("option", { name: "#Admin" });
    expect(admin.getAttribute("aria-disabled")).toBe("true");
    await user.click(admin);
    expect(admin.getAttribute("aria-selected")).toBe("false");
    await user.type(search, "brand new");
    expect(within(listbox("Tags")).queryByRole("option", { name: /Create/ })).toBeNull();
  });

  it("while recording, tag edits save through the same per-field autosave", async () => {
    const { calls } = renderBar({ activeEntry: running() });
    const { user } = await openTags();
    await user.click(within(listbox("Tags")).getByRole("option", { name: "#Deep work" }));
    await waitFor(() => expect(calls.updateActiveDetails).toHaveBeenCalledWith({
      categoryId: "focus",
      description: "Fix bug",
      tagNames: ["Deep work"]
    }));
    expect(calls.startTimer).not.toHaveBeenCalled();
    expect(calls.stopTimer).not.toHaveBeenCalled();
  });
});

describe("on phones the buttons' lists are sheets", () => {
  it("the Activities list is a full-width sheet with a 44 px Close that returns focus to the block", async () => {
    phone();
    renderBar();
    const { user } = await openActivities();
    const surface = surfaceOf(listbox("Activities"));
    expect(surface.className).toContain("is-sheet");
    expect(surface.style.left).toBe("12px");
    expect(surface.style.right).toBe("12px");
    expect(surface.style.maxHeight).toMatch(/px$/);
    const close = within(surface).getByRole("button", { name: "Close activities" });
    expect((close as HTMLButtonElement).hidden).toBe(false);
    await user.click(close);
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(activityButton()));
  });

  it("the Tags list is a full-width sheet with a 44 px Close that returns focus to the Tags button", async () => {
    phone();
    renderBar();
    const { user } = await openTags();
    const surface = surfaceOf(listbox("Tags"));
    expect(surface.className).toContain("is-sheet");
    expect(surface.style.left).toBe("12px");
    expect(surface.style.right).toBe("12px");
    await user.click(within(surface).getByRole("button", { name: "Close tags" }));
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.activeElement).toBe(tagsButton());
  });
});

describe("Codex r1 on #402", () => {
  // jsdom has no layout: record which element each scrollIntoView call was made on.
  function recordScrolls() {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this);
    };
    return scrolled;
  }
  const original = Element.prototype.scrollIntoView;
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });

  const MANY_ACTIVITIES: CategoryRow[] = Array.from({ length: 32 }, (_, index) => ({
    id: `a${index}`,
    name: `Activity ${String(index).padStart(2, "0")}`,
    color: "blue",
    isPinned: false
  }));
  const MANY_TAGS = Array.from({ length: 32 }, (_, index) => ({
    id: `t${index}`,
    name: `Tag ${String(index).padStart(2, "0")}`,
    normalizedName: `tag-${String(index).padStart(2, "0")}`,
    usageCount: 1
  }));

  it("keeps the highlighted activity in view: the current one on open, then as ↑/↓ move", async () => {
    const scrolled = recordScrolls();
    renderBar({ categories: MANY_ACTIVITIES, categoryId: "a25" });
    const { search, user } = await openActivities();
    const current = within(listbox("Activities")).getByRole("option", { name: "Activity 25" });
    expect(search.getAttribute("aria-activedescendant")).toBe(current.id);
    await waitFor(() => expect(scrolled.at(-1)).toBe(current));
    await user.keyboard("{ArrowDown}");
    const next = within(listbox("Activities")).getByRole("option", { name: "Activity 26" });
    await waitFor(() => expect(scrolled.at(-1)).toBe(next));
    // Wrapping to the top brings "No activity" back into view.
    await user.keyboard("{ArrowDown}".repeat(7));
    await waitFor(() => expect(scrolled.at(-1)).toBe(within(listbox("Activities")).getByRole("option", { name: "No activity" })));
  });

  it("keeps the highlighted tag in view in the Tags button's list and the typed # list", async () => {
    const scrolled = recordScrolls();
    renderBar({ tags: MANY_TAGS });
    const { search, user } = await openTags();
    await user.keyboard("{ArrowUp}");
    const last = within(listbox("Tags")).getByRole("option", { name: "#Tag 31" });
    expect(search.getAttribute("aria-activedescendant")).toBe(last.id);
    await waitFor(() => expect(scrolled.at(-1)).toBe(last));
    await user.keyboard("{Escape}");

    const input = screen.getByLabelText("Description") as HTMLInputElement;
    await user.click(input);
    await user.type(input, "#tag", { skipClick: true });
    await user.keyboard("{ArrowUp}");
    const typedLast = within(listbox("Tags")).getAllByRole("option").at(-1)!;
    expect(input.getAttribute("aria-activedescendant")).toBe(typedLast.id);
    await waitFor(() => expect(scrolled.at(-1)).toBe(typedLast));
  });

  it("holds the list open while a Create is saving: the phone Close is unavailable and a late failure shows with the name kept", async () => {
    phone();
    let settle: (outcome: unknown) => void = () => undefined;
    const createCategory = vi.fn(() => new Promise((resolve) => { settle = resolve; }));
    renderBar({ createCategory });
    const { search, user } = await openActivities();
    await user.type(search, "Reading");
    await user.keyboard("{ArrowDown}{Enter}");
    const form = screen.getByRole("dialog", { name: "Create new activity" });
    await user.click(within(form).getByRole("button", { name: "Create" }));
    expect(createCategory).toHaveBeenCalledWith("Reading", undefined);

    const surface = form.closest<HTMLElement>(".df-flist")!;
    const close = within(surface).getByRole("button", { name: "Close activities" }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    fireEvent.click(close);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.body);
    expect(surface.className).toContain("is-open");
    expect(activityButton().getAttribute("aria-expanded")).toBe("true");

    await act(async () => settle({ ok: false, error: "An activity named “Reading” already exists." }));
    expect(within(form).getByRole("alert").textContent).toBe("An activity named “Reading” already exists.");
    expect((within(form).getByLabelText("Name") as HTMLInputElement).value).toBe("Reading");
    expect(surface.className).toContain("is-open");
    expect(close.disabled).toBe(false);
  });

  it("fades out where it stood: the Activities list keeps its measured position and width through dismissal", async () => {
    renderBar();
    const { user } = await openActivities();
    const surface = surfaceOf(listbox("Activities"));
    const open = { left: surface.style.left, top: surface.style.top, width: surface.style.width, maxHeight: surface.style.maxHeight };
    expect(open.left).toMatch(/px$/);
    expect(open.top).toMatch(/px$/);
    expect(open.width).toMatch(/px$/);
    expect(surface.style.visibility).toBe("");

    await user.keyboard("{Escape}");
    expect(surface.className).not.toContain("is-open");
    // Same geometry, and no inline visibility cutting the 120 ms fade short.
    expect({ left: surface.style.left, top: surface.style.top, width: surface.style.width, maxHeight: surface.style.maxHeight }).toEqual(open);
    expect(surface.style.visibility).toBe("");
  });
});
